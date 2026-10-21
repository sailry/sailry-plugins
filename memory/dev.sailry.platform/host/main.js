import {readTurnState,stageTurnState} from "sailry/sdk";
import {bytes,index,retrieve,values,reads,argumentsFor} from "./policy.js";
import {readMemorySettings} from './settings.js';
import {indexMemories,searchMemories,reviewMemories} from './retrieval.js';
import {snapshotChanged} from './storage.js';
import {enabled} from './workflow.js';
export {save,forget,consolidate,result} from './workflow.js';

export async function initialize({tools,project,resources}) {
  const settings = await readMemorySettings();
  const state = {settings,project,remaining:settings.context_bytes,reads:[]};
  let instruction = "";
  if (settings.enabled && resources) {
    let entries=[];
    try { entries=await indexMemories(project); }
    catch (error) { if (!snapshotChanged(error)) throw error; state.index_pending=true; }
    instruction = index(entries, project, settings, state.index_pending===true);
    state.remaining = Math.max(0,state.remaining-bytes(instruction));
  }
  stageTurnState(state);
  return {instruction,tools:tools.filter(name => settings.enabled && (settings.auto_write || ["search_memory","review_memories"].includes(name)))};
}

export function beforeModel({results}) {
  const state = readTurnState();
  state.reads = reads(results);
  stageTurnState(state);
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
