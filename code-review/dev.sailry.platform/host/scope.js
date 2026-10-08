import {callId} from 'sailry/sdk';
import {inventory, change} from './git.js';
import {excluded} from './filter.js';
import {groups as partition} from './groups.js';
import {rule} from './matching.js';
import {clone, fail, fields, identifier, integer, limits, size} from './policy.js';
import {head, key, manifest, record, shards, transaction, write} from './records.js';

export async function page(value, offset = 0, limit = limits.page, content = null) {
  integer(offset, 'review offset', 0, limits.inventory+limits.files*2+limits.findings);
  integer(limit, 'review page limit', 1, limits.page);
  const scope = content ?? await manifest(value);
  const total = scope.rows.length + value.findings.length;
  if (offset > total) fail('Review offset exceeds the scope');
  const result = {review_id:value.id, snapshot:value.snapshot, status:value.status,
    creator:value.creator, counts:{...value.counts,findings:value.findings.length},
    reviewed_groups:value.reviewed_groups, offset, next:null, files:[],groups:[],skipped:[],findings:[]};
  let next = offset;
  for (; next < total && next-offset < limit; next++) {
    let row = scope.rows[next];
    if (!row) {
      const current = await record(key(value.id, `finding/${value.findings[next-scope.rows.length]}`));
      if (!current.present || current.value?.kind !== 'finding') fail('Review finding is unavailable', 'internal');
      row = {kind:'finding',value:current.value.finding};
    }
    const target = {file:'files',group:'groups',skipped:'skipped',finding:'findings'}[row.kind];
    result[target].push(row.value);
    if (size(result) > limits.output) {
      result[target].pop();
      if (next === offset) fail('Review page item exceeds the bounded output budget');
      break;
    }
  }
  result.next = next < total ? next : null;
  return result;
}
export async function prepare(input, actor) {
  const args = fields(input, ['target','review_id','offset','limit']);
  if (args.review_id !== undefined) {
    identifier(args.review_id);
    if (args.target !== undefined) fail('Existing reviews have an immutable target');
    const current = await head(args.review_id, actor);
    return {result:await page(current.value,args.offset,args.limit)};
  }
  if (args.offset !== undefined || args.limit !== undefined) fail('Paging requires a review identifier');
  const id = identifier(callId());
  if ((await record(key(id,'head'))).present) fail('Review scope already exists', 'conflict');
  const target = args.target ?? {kind:'worktree',data:{scope:'all'}};
  const listed = await inventory(actor.worktree, target);
  const files = [], skipped = [];
  const eligible = listed.entries.filter(entry => {
    const reason = excluded(entry.path) ?? (entry.old_path ? excluded(entry.old_path) : null);
    if (reason) skipped.push({path:entry.path,reason});
    return !reason;
  });
  if (eligible.length > limits.files) fail('Review scope exceeds the bounded file budget');
  for (const entry of eligible) {
    const current = await change(actor.worktree,listed.snapshot,entry);
    if (current.binary || current.skip_reason) {
      skipped.push({path:entry.path,reason:current.skip_reason ?? 'binary file'});
      continue;
    }
    files.push({path:entry.path,old_path:entry.old_path ?? null,kind:entry.kind,
      metadata_revision:entry.metadata_revision,revision:current.revision,
      rule:rule(entry.path,current.first_line),group:null});
  }
  const groups = partition(files);
  for (const group of groups) for (const path of group.files) files.find(file => file.path === path).group = group.id;
  const rows = [...files.map(value => ({kind:'file',value})),
    ...groups.map(value => ({kind:'group',value})),...skipped.map(value => ({kind:'skipped',value}))];
  const stored = shards(id,'scope','scope',rows);
  const value = {v:1,kind:'head',id,creator:actor.session,worktree:actor.worktree,
    package:clone(actor.package),snapshot:listed.snapshot,status:'open',pages:stored.pages,
    counts:{files:files.length,groups:groups.length,skipped:skipped.length},
    findings:[],reviewed_groups:[],receipts:[]};
  const output = await page(value,0,limits.page,{rows,files,groups,skipped});
  return transaction([write(key(id,'head'),value),...stored.operations],output);
}
