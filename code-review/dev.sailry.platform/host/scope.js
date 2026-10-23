import {callId} from 'sailry/sdk';
import {inventory, change, context} from './git.js';
import {append,begin,discard,finish,flush,recover} from './capture.js';
import {excluded} from './filter.js';
import {groups as partition} from './groups.js';
import {rule} from './matching.js';
import {clone, fail, fields, identifier, integer, limits, size} from './policy.js';
import {head, key, manifest, record, shards, write} from './records.js';

export async function page(value, offset = 0, limit = limits.page, content = null) {
  integer(offset, 'review offset', 0, Number.MAX_SAFE_INTEGER);
  integer(limit, 'review page limit', 1, Number.MAX_SAFE_INTEGER);
  const scope = content ?? await manifest(value);
  const total = scope.rows.length + value.findings.length;
  if (offset > total) fail('Review offset exceeds the scope');
  const result = {review_id:value.id, snapshot:value.snapshot, status:value.status,
    creator:value.creator, counts:{...value.counts,findings:value.findings.length},
    reviewed_groups:value.reviewed_groups, offset, next:null, files:[],groups:[],skipped:[],findings:[]};
  let next = offset;
  for (; next < total && next-offset < Math.min(limit,limits.page); next++) {
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
    return await page(current.value,args.offset,args.limit);
  }
  if (args.offset !== undefined) fail('offset requires an existing review_id');
  const limit = integer(args.limit === undefined ? limits.page : args.limit, 'review page limit', 1, Number.MAX_SAFE_INTEGER);
  const id = identifier(callId());
  if ((await record(key(id,'head'))).present) fail('Review scope already exists', 'conflict');
  const target = args.target ?? {kind:'worktree',data:{scope:'all'}};
  const listed = await inventory(actor.worktree, target);
  await recover(actor);
  const owner=await begin(id,actor);
  try {
    const files = [], skipped = [];
    const eligible = listed.entries.filter(entry => {
      const reason = excluded(entry.path) ?? (entry.old_path ? excluded(entry.old_path) : null);
      if (reason) skipped.push({path:entry.path,reason});
      return !reason;
    });
    for (const entry of eligible) {
      const start=owner.value.chunks;
      const current = await change(actor.worktree,listed.snapshot,entry,true,async page => {
        await append(owner,'data',{v:1,kind:'content',path:entry.path,part:'diff',
          revision:page.revision,offset:page.offset,next:page.next,lines:page.lines});
      });
      if (current.binary || current.skip_reason) {
        skipped.push({path:entry.path,reason:current.skip_reason ?? 'binary file'});
        continue;
      }
      const file={path:entry.path,old_path:entry.old_path ?? null,kind:entry.kind,
        metadata_revision:entry.metadata_revision,revision:current.revision,
        rule:rule(entry.path,current.first_line),group:null,
        content:{diff:{start,count:owner.value.chunks-start}}};
      for (const side of ['old','new']) {
        const start=owner.value.chunks;
        await context(actor.worktree,listed.snapshot,file,side,async page => {
          await append(owner,'data',{v:1,kind:'content',path:file.path,part:side,
            revision:file.revision,offset:page.offset,next:page.next,text:page.text});
        });
        file.content[side]={start,count:owner.value.chunks-start};
      }
      files.push(file);
    }
    const groups = partition(files);
    for (const group of groups) for (const path of group.files) files.find(file => file.path === path).group = group.id;
    const rows = [...files.map(value => ({kind:'file',value})),
      ...groups.map(value => ({kind:'group',value})),...skipped.map(value => ({kind:'skipped',value}))];
    const stored = shards(id,'scope','scope',rows);
    for (const operation of stored.operations) await append(owner,'scope',operation.data.value);
    const value = {v:1,kind:'head',id,creator:actor.session,worktree:actor.worktree,
      package:clone(actor.package),snapshot:listed.snapshot,status:'open',pages:stored.pages,
      counts:{files:files.length,groups:groups.length,skipped:skipped.length},
      findings:[],reviewed_groups:[],receipts:[]};
    const output = await page(value,0,limit,{rows,files,groups,skipped});
    // Recheck the entire inventory and every strong content revision before publishing.
    await Promise.all(files.map(file=>change(actor.worktree,listed.snapshot,file)));
    await inventory(actor.worktree,null,listed.snapshot);
    await flush(owner);
    await finish(owner,[write(key(id,'head'),value)]);
    return output;
  } catch (error) {
    await discard(id,actor);
    throw error;
  }
}
