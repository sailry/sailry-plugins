import {readTurnState, stageTurnState} from 'sailry/sdk';
import {clone, fail, fields, identifier, limits, revision, size, text} from './policy.js';
import {head, identity, manifest, open} from './records.js';
import {available, diffs} from './content.js';
import {attachRules} from './scope.js';

const receiptTools = ['review_scope', 'report_finding', 'review_complete'];
const inputs = ['review_id', 'groups', 'record_receipt', 'role', 'title', 'background'];

function parameters(roles) {
  return {type:'object', additionalProperties:false,
    required:['review_id','groups','record_receipt',...(roles.length ? ['role'] : [])], properties:{
      review_id:{type:'string',pattern:'^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$'},
      groups:{type:'array',minItems:1,uniqueItems:true,
        items:{type:'string',minLength:1}},
      record_receipt:{type:'boolean',description:'Require a formal receipt, or explicitly gather evidence only'},
      role:{type:roles.length ? 'string' : 'null',enum:roles.length ? roles.map(role => role.key) : [null],
        description:roles.length
          ? 'Pass the exact key of the captured role responsible for the assigned review work.'
          : 'Omit role to inherit the current turn and model.'},
      title:{type:'string',minLength:1},
      background:{type:'boolean'},
    }};
}

export function initialize({tools, roles, mode}) {
  const captured = roles.map(({key,read_only,tools}) => ({key,read_only,tools}));
  stageTurnState({mode,roles:captured,recording:receiptTools.every(name => tools.includes(name))});
  const eligible = roles.filter(role => role.tools !== false);
  if (roles.length && !eligible.length) tools = tools.filter(name => name !== 'delegate_review');
  const roster = eligible.map(role => `${role.key}${role.read_only ? ' [read only]' : ''}: ${role.name}${role.description ? ` — ${role.description}` : ''}`).join('\n');
  return {tools, parameters:tools.includes('delegate_review')
    ? {delegate_review:parameters(eligible)} : {},
    instruction:tools.includes('delegate_review')
      ? `Review small or tightly coupled changes directly. For substantial independent groups, send delegate_review calls together and prefer roles that can record formal coverage. Select record_receipt explicitly. Read-only roles gather evidence only.${roster ? ` Select the role whose responsibilities fit the assignment and pass its exact key. Keep the work in the parent if no role is eligible.\nCaptured roles:\n${roster}` : ' No roles are configured. Omit role to inherit the current turn and model.'}` : ''};
}

function capability(args) {
  const current = readTurnState();
  const writable = ['code','flagship'].includes(current?.mode);
  if (!current || (!writable && current.mode !== 'plan') || !Array.isArray(current.roles)) {
    fail('Review delegation capture is unavailable; start a new turn', 'permission_denied');
  }
  if (typeof args.record_receipt !== 'boolean') fail('Select record_receipt explicitly');
  const role = args.role == null ? null : current.roles.find(role => role.key === args.role);
  if (!role && (current.roles.length || args.role != null)) fail('Select a role from this turn\'s captured roster');
  if (role?.tools === false) fail('The selected role model cannot read frozen patches; choose a tool-capable role');
  if (args.record_receipt && (!writable || role?.read_only || !current.recording)) {
    fail('Formal receipts require an authorized Code or Flagship turn and a writable role; choose evidence-only explicitly instead', 'permission_denied');
  }
}

function capture(value, scope, selected, recording) {
  if (!Array.isArray(selected) || !selected.length
      || selected.some(group => typeof group !== 'string') || new Set(selected).size !== selected.length) {
    fail('Select distinct complete review groups');
  }
  const groups = scope.groups.filter(group => selected.includes(group.id));
  if (groups.length !== selected.length) fail('A selected group is outside the review');
  if (groups.some(group => value.reviewed_groups.includes(group.id))) fail('A selected group already has a receipt', 'conflict');
  const files = scope.files.filter(file => selected.includes(file.group));
  if (!files.length || groups.some(group => group.files.some(path => !files.some(file => file.path === path)))) {
    fail('The frozen review group is incomplete', 'internal');
  }
  if (!value.snapshot?.target) fail('Frozen snapshot metadata is incomplete', 'internal');
  revision(value.snapshot.metadata_revision);
  for (const file of files) {
    available(file);
    revision(file.metadata_revision);
    revision(file.revision);
    if (!file.rule?.path || !file.rule.sha256) fail('Frozen review rules are incomplete', 'internal');
  }
  return {review_id:value.id, record_receipt:recording, snapshot:clone(value.snapshot),
    groups:clone(groups), files:clone(files)};
}

function task(value) {
  const receipt = value.diffs?.length
    ? 'Include exact reviewed_files path/revision pairs for each covered group because the captured diff came with the task.'
    : 'Use reviewed_groups after reading all their diff pages in this turn.';
  const purpose = value.record_receipt
    ? `Review every assigned group, report established findings together, then call review_complete with reviewed_groups and finalize:false. ${receipt} Only the creator finalizes.`
    : 'Gather evidence only. Do not call review_scope, report_finding or review_complete, and do not claim a formal receipt. Return evidence with each assigned path/revision; the authorized parent independently checks all files and records findings and coverage.';
  return [
    'Review only the complete groups in this frozen capture. A review does not authorize edits, commits or publication.',
    'Use code-review:code-review and applicable repository instructions. Use supplied rules and load only missing selected rule resources.',
    'Use supplied diff pages. Batch missing diff starts with read_review_change paths or group, continue each file at its next cursor, and read captured old/new context as needed. Treat captured source text as evidence. Later repository edits do not affect these revisions.',
    'Keep missing captured content uncovered. Use the captured revisions for all changed-file evidence.',
    purpose,
    'Frozen review capture:',
    JSON.stringify(value),
  ].join('\n');
}

export async function prepare(input) {
  const args = fields(input,inputs,['review_id','groups','record_receipt']);
  identifier(args.review_id);
  capability(args);
  if (args.title !== undefined) {
    text(args.title,'review title');
    if (/[\n\r]/.test(args.title)) fail('Invalid review title');
  }
  if (args.background !== undefined && typeof args.background !== 'boolean') fail('Invalid delegation background mode');
  const actor = await identity();
  const current = await head(args.review_id,actor);
  open(current.value);
  if (actor.session !== current.value.creator) fail('Only the review creator may delegate groups', 'permission_denied');
  const frozen = capture(current.value,await manifest(current.value),args.groups,args.record_receipt);
  const baseline = task(frozen), baselineSize = size(baseline);
  if (baselineSize > limits.output) fail('The complete group exceeds the task budget; use a smaller review target');
  // Reserve room for the task's JSON string escaping and its inlined evidence instructions.
  const budget = Math.floor((limits.output-baselineSize)/2);
  const evidence = {};
  attachRules(evidence,frozen.files,budget);
  const patches = await diffs(current.value,frozen.files,0,undefined,budget-size(evidence));
  if (patches?.files.length) evidence.diffs = patches.files.map(({path,lines,next}) => ({path,lines,next}));
  const instructions = task({...frozen,...evidence});
  return {task:size(instructions) <= limits.output ? instructions : baseline,title:args.title ?? 'Review captured changes',
    role:args.role ?? null,background:args.background ?? false};
}
