import {readTurnState,stageTurnState} from "sailry/sdk";
import {bytes,instruction,values,reads,argumentsFor,retrieve} from "./policy.js";
import {readMemorySettings} from './settings.js';
import {indexMemories,searchMemories,reviewMemories} from './retrieval.js';
import {snapshotChanged,stable,head,unchanged} from './storage.js';
import {recordRecalls} from './recall.js';
import {enabled} from './workflow.js';
export {save,forget,consolidate,result} from './workflow.js';

// Relevance is best effort: a failed message search still leaves the index.
// Keyword matching keeps unrelated entries out when semantic ranking is available.
async function relevant(project,message) {
  if (typeof message !== 'string' || !message.trim()) return [];
  try { return await searchMemories(project,message,{keyword:true}); }
  catch { return []; }
}
// Titles and relevant bodies come from one committed catalog revision.
function capture(project,message) {
  return stable(async()=>{
    const before = await head();
    const captured = await Promise.all([indexMemories(project),relevant(project,message)]);
    await unchanged(before.record.revision);
    return captured;
  });
}
const counting = state => state.settings.enabled && state.settings.auto_write && state.mode !== 'plan';

export async function initialize({tools,project,resources,message,mode}) {
  const settings = await readMemorySettings();
  const state = {settings,project,mode,remaining:settings.context_bytes,reads:[],recalled:[]};
  let text = "";
  if (settings.enabled && resources) {
    let entries=[], hits=[];
    try { [entries,hits]=await capture(project,message); }
    catch (error) { if (!snapshotChanged(error)) throw error; state.index_pending=true; }
    const built = instruction({relevant:hits,entries,settings,pending:state.index_pending===true});
    text = built.text;
    state.remaining = Math.max(0,state.remaining-bytes(text));
    state.recalled = built.injected.map(entry=>entry.summary.id);
    if (built.injected.length && counting(state)) {
      await recordRecalls(built.injected.map(entry=>entry.summary),new Set(entries.map(summary=>summary.id)));
    }
  }
  stageTurnState(state);
  return {instruction:text,tools:tools.filter(name => settings.enabled && (settings.auto_write || ["search_memory","review_memories"].includes(name)))};
}

export async function beforeModel({results}) {
  const state = readTurnState();
  state.reads = reads(results);
  // This turn's search hits are counted once, in at most one optional write.
  const recalled = new Set(state.recalled ?? []);
  const fresh = (state.searched ?? []).filter(summary=>!recalled.has(summary.id));
  const count = fresh.length > 0 && !state.search_counted && counting(state);
  if (count) {
    state.search_counted = true;
    state.recalled = [...recalled,...fresh.map(summary=>summary.id)];
  }
  // Read authority is staged before the optional write so it never waits on statistics.
  stageTurnState(state);
  if (count) await recordRecalls(fresh);
  return null;
}

const protect = handler => async input => {
  try { return await handler(input); }
  catch (error) { return {error:{code:error.code ?? "internal",message:error.message},isError:true}; }
};

export const search = protect(async input => {
  const value = argumentsFor(input,["query"],["query"]);
  const state = await enabled(false);
  let captured;
  try { captured=await searchMemories(state.project,value.query); }
  catch (error) { if (!snapshotChanged(error)) throw error; return {status:'pending',budget_remaining_bytes:state.remaining,budget_limited:true}; }
  const entries = retrieve(captured,state);
  const shown = new Set(entries.map(entry=>JSON.parse(entry.parts[0].text).summary.id));
  const searched = new Map((state.searched ?? []).map(summary=>[summary.id,summary]));
  for (const {summary} of captured) if (shown.has(summary.id)) searched.set(summary.id,{id:summary.id,project:summary.project});
  state.searched = [...searched.values()];
  stageTurnState(state);
  return {entries,budget_remaining_bytes:state.remaining,budget_limited:true};
});
export const review = protect(async input => {
  argumentsFor(input,[],[]);
  const state = await enabled(false);
  let captured;
  try { captured=await reviewMemories(await readMemorySettings(),{project:state.project,all_projects:false}); }
  catch (error) { if (!snapshotChanged(error)) throw error; return {status:'pending'}; }
  const hints = values(captured,state);
  stageTurnState(state);
  return {candidates:hints};
});
