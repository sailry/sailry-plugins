import {readTurnState,stageTurnState} from 'sailry/sdk';

const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const fields = ['connection','expected_revision','name','host','port','username','authentication','key_path'];
const invalid = () => ({isError:true,error:{code:'invalid_request',message:'Invalid SSH connection arguments'}});
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;

export function connections(args) {
  return object(args) && Object.keys(args).length === 0 ? {} : invalid();
}

export function save(args) {
  if (!object(args) || Object.keys(args).some(key=>!fields.includes(key))) return invalid();
  const create = args.connection == null && args.expected_revision == null;
  if (!create && (!uuid.test(args.connection) || !readTurnState().connections.includes(args.connection)
      || !Number.isSafeInteger(args.expected_revision) || args.expected_revision < 1)) return invalid();
  for (const field of ['name','host','username','key_path']) {
    if (field in args && !text(args[field])) return invalid();
  }
  if (('authentication' in args && !['agent','key_path'].includes(args.authentication))
      || ('port' in args && (!Number.isInteger(args.port) || args.port < 1 || args.port > 65535))
      || (args.authentication === 'agent' && 'key_path' in args)) return invalid();
  if (create && (!text(args.name) || !text(args.host) || !Number.isInteger(args.port)
      || !text(args.username) || !args.authentication)) return invalid();
  if (create && args.authentication === 'key_path' && !text(args.key_path)) return invalid();
  if (!create) return {...args};
  const {connection,expected_revision,...values} = args;
  return values;
}

export function saved({arguments:args,output}) {
  if (output && !output.isError && !output.error && output.kind === 'ssh_profile' && uuid.test(output.data?.id)
      && (args.connection == null || args.connection === output.data.id)) {
    const state = readTurnState();
    stageTurnState({...state,connections:[...new Set([...state.connections,output.data.id])]});
  }
  return output;
}
