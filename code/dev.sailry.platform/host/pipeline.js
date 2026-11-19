import {invalid, size} from './limits.js';

// These are worktree reads. The Node binds their scope and executes each operation.
const inputs = new Map([
  ['code.search', ['name','query','path','language','limit']],
  ['code.outline', ['path']],
  ['code.graph', ['view','name','paths','line','depth','offset','limit']],
  ['files.find', ['globs','path','offset','limit']],
  ['files.search', ['query','regex','case_sensitive','globs','path','mode','context','type','offset','limit','multiline']],
  ['files.read_lines', ['path','offset','limit','expected_revision']],
]);

function field(data, pointer) {
  if (pointer === '') return data;
  if (typeof pointer !== 'string' || !pointer.startsWith('/') || /~(?![01])/.test(pointer)) throw new Error('Invalid result pointer');
  for (const part of pointer.slice(1).split('/')) {
    const key = part.replace(/~1/g,'/').replace(/~0/g,'~');
    if (data === null || typeof data !== 'object' || !Object.prototype.hasOwnProperty.call(data,key) ||
        (Array.isArray(data) && !/^(0|[1-9][0-9]*)$/.test(key))) throw new Error(`No result at ${pointer}`);
    data = data[key];
  }
  return data;
}

export function pipeline({arguments:input,step,outcome,state}) {
  try {
    const steps = input.steps;
    if (!Array.isArray(steps) || steps.length < 2 || steps.length > 8 || !Number.isInteger(step) || step < 0 || step > steps.length) return invalid('Expected two to eight dependent reads');
    if (outcome?.isError) return {result:outcome};
    const data = outcome?.data;
    const partial = state?.partial_steps ?? [];
    if (step && (data?.partial || data?.truncated || data?.next_offset != null)) partial.push(step);
    if (step === steps.length) {
      const result = {value:field(data,input.select ?? '')};
      if (partial.length) result.partial_steps = partial;
      if (size(result) > 16384) return invalid('Selected output exceeds 16 KiB; narrow the read or select a smaller field');
      return {result};
    }
    const {operation,arguments:args={},from_previous:bindings={}} = steps[step];
    const keys = inputs.get(operation);
    if (!keys || [...Object.keys(args),...Object.keys(bindings)].some(key => !keys.includes(key))) return invalid('Unsupported read operation or argument');
    const references = Object.entries(bindings);
    if ((step === 0) !== (references.length === 0)) return invalid('Only dependent reads belong in a pipeline; send independent reads together as ordinary tool calls');
    const parameters = {...args};
    for (const [key,pointer] of references) {
      if (Object.prototype.hasOwnProperty.call(args,key)) return invalid(`Duplicate argument ${key}`);
      parameters[key] = field(data,pointer);
    }
    if (keys.includes('limit')) {
      parameters.limit ??= 8;
      if (!Number.isInteger(parameters.limit) || parameters.limit < 1 || parameters.limit > 64) return invalid('Read limit must be between 1 and 64');
    }
    return {call:{operation,arguments:parameters},state:{partial_steps:partial}};
  } catch (error) {
    return invalid(error.message);
  }
}
