import {prepareRequest, completeRequest, forgetRequest} from 'sailry/sdk';
import {equal, fail, limits, path, revision, size} from './policy.js';

async function read(kind, data, expected) {
  const request = prepareRequest({kind, data});
  try {
    const outcome = await completeRequest(request);
    if (outcome?.Err) fail(outcome.Err.message, outcome.Err.code);
    if (outcome?.Ok?.kind !== expected) fail('Unexpected Git result', 'internal');
    return outcome.Ok.data;
  } finally { forgetRequest(request); }
}
export async function inventory(worktree, target, snapshot = null) {
  const entries = [], seen = new Set();
  let total = 2;
  let cursor = snapshot ? {snapshot, after_path:null} : null;
  let frozen = snapshot;
  for (;;) {
    const data = {worktree, target:cursor ? null : target, cursor, limit:200};
    const page = await read('list_git_changes', data, 'git_changes');
    if (!page.snapshot || !Array.isArray(page.entries) || page.omitted_paths !== 0
        || typeof page.exhausted !== 'boolean') fail('Git inventory is incomplete');
    if (frozen && !equal(frozen, page.snapshot)) fail('Review target changed', 'revision_conflict');
    frozen = page.snapshot;
    for (const entry of page.entries) {
      path(entry.path);
      if (entry.old_path != null) path(entry.old_path);
      revision(entry.metadata_revision);
      if (seen.has(entry.path)) fail('Git inventory contains duplicate paths', 'internal');
      seen.add(entry.path);
      entries.push(entry);
      total += size(entry)+1;
      if (total > limits.transaction) {
        fail('Review inventory exceeds the bounded scope budget');
      }
    }
    if (page.exhausted) {
      if (page.next != null) fail('Invalid Git inventory cursor', 'internal');
      return {snapshot:frozen, entries};
    }
    if (!page.entries.length || !page.next || !equal(page.next.snapshot, frozen)
        || page.next.after_path !== entries.at(-1).path) fail('Git inventory is incomplete');
    cursor = page.next;
  }
}
export async function change(worktree, snapshot, file, all = false) {
  let offset = 0, frozen = file.revision ?? null, total = 0;
  const lines = [];
  for (;;) {
    const page = await read('read_git_change', {worktree, snapshot, path:file.path,
      expected_metadata_revision:file.metadata_revision, expected_revision:frozen,
      offset, limit:500}, 'git_change');
    revision(page.revision);
    if (!equal(page.snapshot, snapshot) || page.path !== file.path
        || page.metadata_revision !== file.metadata_revision || page.offset !== offset
        || (frozen && frozen !== page.revision) || !Array.isArray(page.lines)) {
      fail('Reviewed file changed', 'revision_conflict');
    }
    frozen = page.revision;
    if (page.binary || page.skip_reason) {
      if (page.lines.length) fail('Skipped Git file returned content', 'internal');
      return {...page, lines:[], revision:frozen};
    }
    if (!all) return {...page, revision:frozen};
    for (const line of page.lines) {
      if (!['added','deleted','context'].includes(line.kind) || typeof line.text !== 'string'
          || line.text.includes('\n')
          || (line.kind !== 'deleted' && (!Number.isSafeInteger(line.new_line) || line.new_line < 1))
          || (line.kind !== 'added' && (!Number.isSafeInteger(line.old_line) || line.old_line < 1))) {
        fail('Invalid mapped Git line', 'internal');
      }
      lines.push(line);
      total += size(line);
      if (total > limits.patch) fail('Review evidence exceeds the bounded diff budget');
    }
    if (page.next == null) return {...page, lines, revision:frozen};
    if (!Number.isSafeInteger(page.next) || page.next !== offset + page.lines.length || page.next <= offset) {
      fail('Invalid Git diff cursor', 'internal');
    }
    offset = page.next;
  }
}
