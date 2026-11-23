import {context,inspectGit} from 'sailry/sdk';
import {labels} from './labels.js';

// not_configured: the execution Node has no usable Git executable.
const clearsBadge = new Set(['revision_conflict','not_found','permission_denied','wrong_target','not_configured']);

export async function badge() {
  const hidden = [{id:'changes',visible:false}];
  if (!context().worktree) return hidden;
  try {
    const status = await inspectGit();
    if (status.kind === 'directory') return hidden;
    let added = 0, removed = 0, partial = status.truncated || status.omitted_paths > 0;
    for (const entry of status.entries) {
      added += entry.diff.additions;
      removed += entry.diff.deletions;
      partial ||= entry.diff.truncated === true;
    }
    return [{id:'changes',visible:true,enabled:true,
      segments:[{label:{label:`+${added}`},tone:'success'},{label:{label:`-${removed}`},tone:'danger'}],
      details:[{label:labels.added,value:String(added)},{label:labels.removed,value:String(removed)},
        {label:labels.files,value:String(status.entries.length)},...(partial ? [{label:labels.partial,value:''}] : [])]}];
  } catch (error) {
    if (clearsBadge.has(error.code)) return hidden;
    throw error;
  }
}
