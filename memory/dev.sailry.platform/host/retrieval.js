import {getValue} from 'sailry/sdk';
import {indexed,metadata,body,page,entryKey,scopeTag,head,stable,changed,unchanged} from './storage.js';
import {ordered} from './model.js';
import {query as tokenize} from './tokenize.js';
import {bytes,fail} from './policy.js';
import {review} from './review.js';

async function find({project,all_projects=false,archived=false,query,recall=false}) {
  if (typeof query !== 'string') fail('invalid memory query');
  const all = [`state:${archived ? 'archived' : 'active'}`];
  const any = all_projects ? [] : recall ? Array.from(new Set([scopeTag(null),scopeTag(project)])) : [scopeTag(project)];
  if (/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(query.trim())) {
    const current = await getValue(entryKey(query.trim()));
    if (!current.present) return [];
    const value = metadata(current), owner = value.summary.project;
    return value.summary.archived === archived && (all_projects || owner === project || (recall && owner === null)) ? [current] : [];
  }
  const terms = tokenize(query);
  if (query.trim() && !terms.length) return [];
  return indexed({terms,query:query.trim() ? query : undefined,mode:query.trim() ? 'hybrid' : 'keyword',weights:[3,1],all,any},recall ? 20 : Infinity);
}
async function catalog(project) {
  const before = await head();
  const records = await indexed({terms:[],all:[],any:project === undefined ? [] : Array.from(new Set([scopeTag(null),scopeTag(project)])),weights:[3,1]});
  const after = await head();
  if (before.record.revision !== after.record.revision) changed();
  return {revision:after.record.revision,entries:records.map(metadata)};
}
export async function listMemories(project) {
  return stable(async()=>(await catalog(project)).entries.map(entry=>entry.summary).sort(ordered));
}
async function indexSnapshot(project) {
  const captured = await catalog(project), entries = [];
  const ids=[...new Set(captured.entries.filter(entry=>!entry.summary.archived&&["user","feedback"].includes(entry.summary.kind)).map(entry=>entry.body_page))];
  const pages=new Map(await Promise.all(ids.map(async id=>[id,await page(id)])));
  // A deletion can remove an entire page. Check the head before pairing the
  // captured metadata with its body, preserving real corruption diagnostics.
  if (captured.revision !== (await head()).record.revision) changed('memory catalog changed during indexing');
  for (const entry of captured.entries) {
    const summary = entry.summary;
    if (summary.archived) continue;
    let value = summary;
    if (["user","feedback"].includes(summary.kind)) {
      const current = await body(entry,pages.get(entry.body_page));
      if (bytes(current.body) <= 300) value = {...summary,body:current.body};
    }
    entries.push(value);
  }
  return entries.sort(ordered);
}
export async function indexMemories(project) {
  return stable(()=>indexSnapshot(project));
}
async function reviewSnapshot(settings,filter) {
  const captured = await catalog(filter.all_projects ? undefined : filter.project);
  const entries = new Map(captured.entries.map(entry=>[entry.summary.id,entry])), pages = new Map();
  const hints = await review(captured.entries.map(entry=>entry.summary),settings,filter,async id=>{
    const entry = entries.get(id);
    if (!pages.has(entry.body_page)) pages.set(entry.body_page,page(entry.body_page));
    const source=await pages.get(entry.body_page);
    await unchanged(captured.revision);
    return body(entry,source);
  });
  await unchanged(captured.revision);
  return hints;
}
export async function reviewMemories(settings,filter) { return stable(()=>reviewSnapshot(settings,filter)); }
export async function browseMemories(filter) {
  return (await find(filter)).map(record=>metadata(record).summary);
}
export async function searchMemories(project,query) {
  return stable(async()=>{
    const current=await head(), captured=(await find({project,query,recall:true})).map(metadata);
    const ids=[...new Set(captured.map(value=>value.body_page))];
    const pages=new Map(await Promise.all(ids.map(async id=>[id,await page(id)])));
    await unchanged(current.record.revision);
    return Promise.all(captured.map(value=>body(value,pages.get(value.body_page))));
  });
}
