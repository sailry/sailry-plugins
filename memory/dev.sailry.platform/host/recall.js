// Recall statistics live beside entries, so counting a recall never changes an
// entry, its revision or the model's read authority.
import {getValue,prepareTransaction,completeRequest} from 'sailry/sdk';
import {clock} from './storage.js';

export const recallPrefix = 'memory/recall/';
export const recallKey = project => `${recallPrefix}${project ?? 'global'}`;
const empty = record => ({record,entries:{}});
const limit = 2048;

function counted(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Number.isSafeInteger(value.recalled) && value.recalled >= 0
    && (value.last_recalled === null || (Number.isSafeInteger(value.last_recalled) && value.last_recalled >= 0));
}
async function scope(project) {
  const record = await getValue(recallKey(project));
  const value = record.present ? record.value : null;
  // Statistics are advisory; an unreadable record restarts counting instead of failing recall.
  if (!value || value.v !== 1 || !value.entries || typeof value.entries !== 'object' || Array.isArray(value.entries)) return empty(record);
  return {record,entries:Object.fromEntries(Object.entries(value.entries).filter(([,entry])=>counted(entry)))};
}
export async function readRecalls(projects) {
  const unique = [...new Set(projects)];
  return new Map(await Promise.all(unique.map(async project=>[project,await scope(project)])));
}
export function withRecalls(summary,recalls) {
  const value = recalls.get(summary.project)?.entries[summary.id];
  return {...summary,recalled:value?.recalled ?? 0,last_recalled:value?.last_recalled ?? null};
}
// One optional transaction per call; conflicts and planning restrictions skip counting.
export async function recordRecalls(summaries,known) {
  const selected = summaries.filter(summary=>summary && typeof summary.id === 'string');
  if (!selected.length) return false;
  try {
    const now = await clock();
    const recalls = await readRecalls(selected.map(summary=>summary.project));
    const operations = [];
    for (const [project,current] of recalls) {
      const entries = Object.fromEntries(Object.entries(current.entries)
        .filter(([id])=>!known || known.has(id)));
      for (const summary of selected.filter(summary=>summary.project === project)) {
        entries[summary.id] = {recalled:(entries[summary.id]?.recalled ?? 0)+1,last_recalled:now};
      }
      // Keep the most recently used statistics within the storage value limit.
      const retained = Object.entries(entries).sort(([,left],[,right])=>(right.last_recalled ?? 0)-(left.last_recalled ?? 0)).slice(0,limit);
      operations.push({kind:'write',data:{key:recallKey(project),value:{v:1,entries:Object.fromEntries(retained)},expected_revision:current.record.revision}});
    }
    const outcome = await completeRequest(prepareTransaction(operations));
    return outcome?.Ok !== undefined;
  } catch {
    return false;
  }
}
