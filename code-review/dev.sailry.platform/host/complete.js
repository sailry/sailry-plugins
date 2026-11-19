import {verify} from './content.js';
import {fail, fields, identifier, limits, path, revision, size} from './policy.js';
import {head, key, manifest, open, shards, transaction, write} from './records.js';
import {completion} from './locales.js';
import {missingDelivery} from './delivery.js';

export function display(value) {
  return {...value,sailry_result:{version:1,diagnostics:[],
    status:completion(value.reviewed_files)}};
}

function remaining(scope, covered) {
  const files = scope.files.filter(file => !covered.has(file.group))
    .map(file => ({path:file.path,revision:file.revision}));
  const groups = scope.groups.filter(group => !covered.has(group.id)).map(group => group.id);
  const visible = [];
  let used = 0;
  for (const file of files) {
    const count = size(file);
    if (visible.length === limits.page || used+count > limits.output/2) break;
    visible.push(file);
    used += count;
  }
  return {files:visible,groups:groups.slice(0,limits.page),
    counts:{files:files.length,groups:groups.length},more:visible.length < files.length || groups.length > limits.page};
}

function receipt(args, scope, value) {
  if (!Array.isArray(args.reviewed_groups) || typeof args.finalize !== 'boolean') fail('Invalid review receipt');
  const groups = new Set(), known = new Map(scope.groups.map(group => [group.id,group]));
  const selected = new Set();
  const byPath = new Map(scope.files.map(file => [file.path,file]));
  for (const group of args.reviewed_groups) {
    if (typeof group !== 'string' || groups.has(group)) fail('Duplicate or invalid reviewed group');
    const expected = known.get(group);
    if (!expected) fail('Reviewed group is outside the scope');
    if (value.reviewed_groups.includes(group)) fail('Review group already has a receipt','conflict');
    if (!expected.files?.length) fail('The frozen review group is incomplete','internal');
    for (const path of expected.files) {
      if (byPath.get(path)?.group !== group || selected.has(path)) fail('The frozen review group is incomplete','internal');
      selected.add(path);
    }
    groups.add(group);
  }
  if (!args.finalize && !groups.size) fail('Child or partial completion requires a whole group receipt');
  const files = scope.files.filter(file => groups.has(file.group));
  if (selected.size !== files.length) fail('The frozen review group is incomplete','internal');
  if (Object.hasOwn(args,'reviewed_files')) verifyExplicitFiles(args.reviewed_files,byPath,selected);
  return {files,groups};
}

function verifyExplicitFiles(input, expected, selected) {
  if (!Array.isArray(input)) fail('Invalid review receipt');
  const files = new Set();
  for (const file of input) {
    fields(file,['path','revision'],['path','revision']);
    path(file.path);
    revision(file.revision);
    if (files.has(file.path)) fail('Duplicate reviewed file');
    if (!expected.has(file.path)) fail('Reviewed file is outside the scope');
    if (expected.get(file.path).revision !== file.revision) fail('Receipt uses a stale file revision','revision_conflict');
    files.add(file.path);
  }
  if ([...selected].some(path => !files.has(path))) fail('Review receipt must cover whole groups');
  if (files.size !== selected.size) fail('Reviewed files require their complete group receipt');
}

export async function prepare(input, actor, intent) {
  const args = fields(input,['review_id','reviewed_files','reviewed_groups','finalize','delivery_token'],
    ['review_id','reviewed_groups','finalize']);
  identifier(args.review_id);
  if (Object.hasOwn(args,'delivery_token')) identifier(args.delivery_token);
  const current = await head(args.review_id,actor);
  open(current.value);
  if (args.finalize && actor.session !== current.value.creator) fail('Only the review creator may finalize','permission_denied');
  const scope = await manifest(current.value);
  const incoming = receipt(args,scope,current.value);
  const covered = new Set([...current.value.reviewed_groups,...incoming.groups]);
  const pending = remaining(scope,covered);
  if (args.finalize && (pending.counts.files || pending.counts.groups)) {
    fail('Review coverage is incomplete','invalid_request',pending);
  }
  if (!Object.hasOwn(args,'reviewed_files')) {
    const files = missingDelivery(args.review_id,args.delivery_token,incoming.files);
    if (files.length) {
      const missingGroups = new Set(files.map(file => file.group));
      const groups = scope.groups.filter(group => missingGroups.has(group.id));
      fail('Read every claimed diff page and submit the newest delivery_token for this review, or use explicit file receipts for evidence already reviewed',
        'invalid_request',remaining({files,groups},new Set()));
    }
  }
  await Promise.all((args.finalize ? scope.files : incoming.files).map(file=>verify(current.value,file)));
  const operations = [];
  current.value.reviewed_groups = scope.groups.map(group => group.id).filter(id => covered.has(id));
  if (incoming.groups.size) {
    const id = identifier(intent);
    if (current.value.receipts.includes(id)) fail('Receipt was already recorded','conflict');
    const rows = [...incoming.files.map(({path,revision}) => ({kind:'file',value:{path,revision}})),
      ...args.reviewed_groups.map(value => ({kind:'group',value})),{kind:'reporter',value:actor.session}];
    const stored = shards(args.review_id,`receipt/${id}`,'receipt',rows);
    operations.push(...stored.operations);
    current.value.receipts.push(id);
  }
  if (args.finalize) current.value.status = 'complete';
  operations.unshift(write(key(args.review_id,'head'),current.value,current.record.revision));
  return transaction(operations,{review_id:args.review_id,status:current.value.status,
    reviewed_files:scope.files.filter(file => covered.has(file.group)).length,
    reviewed_groups:current.value.reviewed_groups,remaining:pending,
    findings:current.value.findings.length});
}
