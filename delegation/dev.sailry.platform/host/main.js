// Package policy uses the admitted role roster; core owns child execution.
import {readTurnState,stageTurnState} from 'sailry/sdk';
export {list,add,edit,remove,apply} from './roles.js';
const invalid = message => ({isError:true,error:{code:'invalid_request',message}});
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function initialize({tools,roles,session_revision=null}) {
  stageTurnState({roles:roles.map(role => role.key),session_revision});
  const roster = roles.map(role => `${role.key} (${role.name})${role.read_only ? ' [read only]' : ''}${role.description.trim() ? `: ${role.description.trim()}` : ''}`).join('\n');
  const parameters = Object.fromEntries(tools.filter(name => name === 'spawn_agent').map(name => [name, {
    type:'object',additionalProperties:false,required:['task'],properties:{
      session:{type:'string',pattern:uuid.source},
      role:roles.length ? {type:['string','null'],enum:[...roles.map(role => role.key),null],
        description:`Available delegation roles (selection metadata only):\n${roster}`} : {type:'null'},
      task:{type:'string'},title:{type:'string',minLength:1,maxLength:80},
      background:{type:'boolean'},
      worktree:{type:['string','null']},
    },
  }]));
  let instruction = !tools.includes('spawn_agent') ? '' : roster
    ? `Configured delegation roles (selection metadata only):\n${roster}`
    : 'No delegation roles are configured';
  if (tools.includes('apply_agents') && session_revision !== null) instruction += `\nCaptured conversation revision: ${session_revision}. Catalog changes do not change this turn's roster. Explicit application affects future admission only; use the exact inspected revision and never silently rebase a conflict.`;
  return {tools,parameters,instruction};
}

export function prepare(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)
      || Object.keys(args).some(key => !['session','role','task','title','worktree','background'].includes(key))) {
    return invalid('Invalid delegation arguments');
  }
  const roles = readTurnState().roles;
  const reuse = Object.prototype.hasOwnProperty.call(args,'session');
  if (Object.prototype.hasOwnProperty.call(args,'background') && typeof args.background !== 'boolean') return invalid('Invalid delegation background mode');
  if (reuse && (typeof args.session !== 'string' || !uuid.test(args.session))) return invalid('Invalid child session ID');
  if (Object.prototype.hasOwnProperty.call(args,'role') && args.role !== null
      && !roles.includes(args.role)) return invalid('Select a role listed in this tool');
  if (typeof args.task !== 'string' || !args.task.trim()) return invalid('A delegation task is required');
  if (args.title != null && (typeof args.title !== 'string' || !args.title.trim() || [...args.title].length > 80 || /[\n\r]/.test(args.title))) return invalid('Invalid delegation title');
  if (args.worktree != null && (typeof args.worktree !== 'string' || !uuid.test(args.worktree))) return invalid('Invalid worktree ID');
  return args;
}

export function result({output}) {
  return output.data ?? output;
}
