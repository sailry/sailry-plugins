// The package owns catalog editing; native services own validation and exact admission.
import {listRoles,newId} from 'sailry/sdk';
const fields = ['key','name','description','instructions','read_only','model','max_turns','skills','appearance'];
const revision = value => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value);
const invalid = message => ({isError:true,error:{code:'invalid_request',message}});
function valid(input,allowed,required) {
  return input && typeof input === 'object' && !Array.isArray(input)
    && Object.keys(input).every(key => allowed.includes(key)) && required.every(key => key in input);
}
function changes(input) {
  return Object.fromEntries(fields.filter(key => key in input).map(key => [key,input[key]]));
}
export async function list(input) {
  if (!valid(input,[],[])) return invalid('Invalid agent arguments');
  return {agents:await listRoles()};
}
export function add(input) {
  if (!valid(input,fields,['key','name','instructions'])) return invalid('Invalid agent definition');
  return {role:{id:newId(),revision:'0',key:'',name:'',description:'',instructions:'',read_only:false,
    model:null,max_turns:null,skills:[],appearance:null,...changes(input)},expected_revision:'0'};
}
export async function edit(input) {
  if (!valid(input,[...fields,'id','expected_revision'],['id','expected_revision']) || !revision(input.expected_revision)
    || input.expected_revision === '0' || !fields.some(key => key in input)) return invalid('Inspect the agent and use its exact revision');
  const current = (await listRoles()).find(role => role.id === input.id);
  if (!current) return {isError:true,error:{code:'not_found',message:'Agent not found'}};
  if (current.revision !== input.expected_revision) return {isError:true,error:{code:'revision_conflict',message:'Agent changed'}};
  return {role:{...current,...changes(input)},expected_revision:input.expected_revision};
}
export function remove(input) {
  if (!valid(input,['id','expected_revision'],['id','expected_revision']) || !revision(input.expected_revision)
    || input.expected_revision === '0') return invalid('Inspect the agent and use its exact revision');
  return {role:input.id,expected_revision:input.expected_revision};
}
export function apply(input) {
  if (!valid(input,['agents','expected_session_revision'],['agents','expected_session_revision'])
    || !revision(input.expected_session_revision) || input.expected_session_revision === '0'
    || !Array.isArray(input.agents)
    || input.agents.some(role => !valid(role,['id','revision'],['id','revision']) || !revision(role.revision) || role.revision === '0')
    || new Set(input.agents.map(role => role.id)).size !== input.agents.length) return invalid('Use distinct agents and exact revisions');
  return {roles:input.agents,expected_revision:input.expected_session_revision};
}
