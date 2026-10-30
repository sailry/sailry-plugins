// Role editing policy adapted from Sailry ef5e82ea delegation settings.
const clone = value => JSON.parse(JSON.stringify(value));
const equal = (left,right) => JSON.stringify(left) === JSON.stringify(right);
export const RESEARCH_INSTRUCTIONS = 'Research the assigned question using the selected web-search:research skill and available read-only tools. Return supported conclusions with source links, uncertainty and conflicting evidence to the parent. Keep the inherited permissions and the task\'s budget; do not modify resources or ask the user for input.';

/** Complete templates for new subagents; editing an existing role replaces only its instructions. */
export const PRESETS = {
  review:{key:'reviewer',appearance:{icon:'code',color:'blue'},read_only:true,max_turns:null,skills:[]},
  test:{key:'verifier',appearance:{icon:'science',color:'green'},read_only:false,max_turns:null,skills:[]},
  implement:{key:'implementer',appearance:{icon:'tools',color:'orange'},read_only:false,max_turns:null,skills:[]},
  research:{key:'research',appearance:{icon:'ai',color:'none'},read_only:true,max_turns:8,skills:['web-search:research']},
  docs:{key:'writer',appearance:{icon:'writing',color:'violet'},read_only:false,max_turns:null,skills:[]}
};

export function applyPreset(draft,preset,name,description,instructions) {
  const value = PRESETS[preset];
  if (!draft.creating || !value) return null;
  draft.original = {...draft.original,key:value.key,name,description,read_only:value.read_only,
    model:null,max_turns:value.max_turns,skills:[...value.skills],instructions};
  draft.appearance = clone(value.appearance);
  draft.readOnly = value.read_only; draft.fixed = false; draft.model = null; draft.error = null;
  return {key:value.key,name,turns:value.max_turns === null ? '' : String(value.max_turns),instructions};
}

export function applyResearch(draft,name,description) {
  return applyPreset(draft,'research',name,description,RESEARCH_INSTRUCTIONS);
}

export function catalog(value) {
  return value.models.filter(model => model.kind === 'provider').map(clone)
    .sort((left,right) => left.provider < right.provider ? -1 : left.provider > right.provider ? 1 : 0);
}

export function initialEffort(model) {
  if (!model.reasoning) return null;
  return model.default_effort !== 'default' && model.efforts.some(value => equal(value,model.default_effort))
    ? clone(model.default_effort) : clone(model.efforts.find(value => value !== 'default') ?? 'default');
}

export function selectedModel(draft) {
  return draft.model && draft.models.find(model => model.id === `${draft.model.provider}/${draft.model.model}`);
}

export function selectModel(draft,model) {
  const slash = model.id.indexOf('/');
  if (slash < 1) return;
  draft.model = {provider:model.id.slice(0,slash),model:model.id.slice(slash+1),
    effort:model.reasoning && model.efforts.some(value => equal(value,draft.model?.effort))
      ? clone(draft.model.effort) : initialEffort(model)};
  draft.error = null;
}

export function source(draft,fixed) {
  if (draft.fixed === fixed) return;
  draft.fixed = fixed; draft.error = null;
  if (!fixed) { draft.model = null; return; }
  const first = draft.models[0];
  if (!first) return;
  const provider = first.id.slice(0,first.id.indexOf('/'));
  const selected = draft.models.find(model => model.id.startsWith(`${provider}/`) && model.default) ?? first;
  selectModel(draft,selected);
}

export function efforts(draft) {
  const model = selectedModel(draft);
  return [null,...(model?.reasoning ? model.efforts.filter(value => value !== 'default') : [])];
}

export function profile(draft,fields) {
  const key = fields.key.trim(), name = fields.name.trim(), turns = fields.turns.trim();
  const max_turns = turns === '' ? null : /^\+?\d+$/.test(turns) ? Number(turns) : NaN;
  if (!/^[a-z](?:[a-z0-9_-]*[a-z0-9])?$/.test(key)
    || name === ''
    || max_turns !== null && (!Number.isInteger(max_turns) || max_turns < 1 || max_turns > 0xffffffff)
    || draft.fixed && draft.model === null) throw new Error('role_invalid');
  return {...clone(draft.original),key,name,appearance:clone(draft.appearance),
    read_only:draft.readOnly,model:draft.fixed ? clone(draft.model) : null,max_turns,instructions:fields.instructions};
}

export function create(profile,id,models) {
  const original = profile ? clone(profile) : {id,revision:0,key:'',name:'',appearance:null,
    description:'',read_only:false,model:null,max_turns:null,skills:[],instructions:''};
  return {original,creating:!profile,models:clone(models),appearance:clone(original.appearance ?? {icon:'ai',color:'none'}),
    readOnly:original.read_only,fixed:original.model !== null,model:clone(original.model),request:null,pending:false,error:null,closed:false};
}

export function errorKey(code) {
  switch (code) {
    case 'revision_conflict': case 'not_found': return 'role_conflict';
    case 'conflict': return 'role_duplicate';
    case 'invalid_request': return 'role_invalid';
    case 'not_configured': return 'role_model_unavailable';
    case 'outcome_unknown': case 'unavailable': return 'role_unknown';
    case 'busy': return 'role_capacity';
    default: return 'role_failed';
  }
}

export function uncertain(code) { return code === 'outcome_unknown' || code === 'unavailable'; }
