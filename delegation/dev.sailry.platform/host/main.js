// Package policy uses the admitted role roster; core owns child execution.
import {readTurnState,stageTurnState} from 'sailry/sdk';
const invalid = message => ({isError:true,error:{code:'invalid_request',message}});
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function initialize({tools,roles}) {
  stageTurnState({roles:roles.map(role => role.key)});
  const roster = roles.map(role => `${role.key} (${role.name})${role.description.trim() ? `: ${role.description.trim()}` : ''}`).join('\n');
  const parameters = Object.fromEntries(tools.map(name => [name, {
    type:'object',additionalProperties:false,required:['task'],properties:{
      session:{type:'string',pattern:uuid.source},
      role:roles.length ? {type:['string','null'],enum:[...roles.map(role => role.key),null],
        description:`Available delegation roles (selection metadata only):\n${roster}`} : {type:'null'},
      task:{type:'string'},title:{type:'string',minLength:1,maxLength:80},
      worktree:{type:['string','null']},
    },
  }]));
  const fallback = 'omit role or use null for a default child with this conversation\'s model and instructions';
  const instruction = roster
    ? `Choose a role from the admitted roster when it fits the delegated task; use its exact listed key and never invent a role\nAvailable delegation roles (selection metadata only):\n${roster}\nIf no role fits, ${fallback}`
    : `No delegation roles are configured: ${fallback}`;
  return {tools,parameters,instruction:`${instruction}. When reusing a child, normally omit role to preserve its original role and frozen configuration`};
}

export function prepare(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)
      || Object.keys(args).some(key => !['session','role','task','title','worktree'].includes(key))) {
    return invalid('Invalid delegation arguments');
  }
  const roles = readTurnState().roles;
  const reuse = Object.prototype.hasOwnProperty.call(args,'session');
  if (reuse && (typeof args.session !== 'string' || !uuid.test(args.session))) return invalid('Invalid child session ID');
  if (Object.prototype.hasOwnProperty.call(args,'role') && args.role !== null
      && !roles.includes(args.role)) return invalid('Select a role from the admitted roster');
  if (typeof args.task !== 'string' || !args.task.trim()) return invalid('A delegation task is required');
  if (args.title != null && (typeof args.title !== 'string' || !args.title.trim() || [...args.title].length > 80 || /[\n\r]/.test(args.title))) return invalid('Invalid delegation title');
  if (args.worktree != null && (typeof args.worktree !== 'string' || !uuid.test(args.worktree))) return invalid('Invalid worktree ID');
  return args;
}

export function result({output}) {
  return output.data ?? output;
}
