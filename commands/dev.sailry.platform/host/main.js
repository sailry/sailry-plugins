import {captions} from './locales.js';

function object(args, keys) {
  return args && typeof args === 'object' && !Array.isArray(args) &&
    Object.keys(args).every(key => keys.includes(key));
}

function invalid(message) {
  return {isError:true,error:{code:'invalid_request',message}};
}

export function run(args) {
  if (!object(args, ['command', 'access', 'description', 'cwd', 'timeout_ms', 'background', 'pty', 'attachments']))
    return invalid('Invalid command arguments');
  const { command, access = 'workspace', description = null, cwd = '', timeout_ms = 120000, background = false, pty = false, attachments = [] } = args;
  if (!['workspace', 'unrestricted'].includes(access) || typeof command !== 'string' || typeof cwd !== 'string' || typeof background !== 'boolean' || typeof pty !== 'boolean' || (pty && !background) ||
      !Number.isSafeInteger(timeout_ms) || timeout_ms < 1 ||
      !Array.isArray(attachments) || attachments.some(id => typeof id !== 'string') ||
      new Set(attachments).size !== attachments.length) {
    return invalid('Invalid command arguments');
  }
  if (description !== null && (typeof description !== 'string' || !description.trim() ||
      description.includes('\0'))) return invalid('Invalid command description');
  return { command, description, cwd, timeout_ms, background, pty, attachments, access };
}

export function read(args) {
  if (!object(args, ['id', 'output', 'stream', 'offset', 'limit']) ||
      (args.id != null && typeof args.id !== 'string') ||
      (args.id != null && args.output != null) ||
      (args.output != null && (!object(args.output, ['call', 'revision']) ||
        typeof args.output.call !== 'string' || !args.output.call ||
        typeof args.output.revision !== 'string' || !/^[a-fA-F0-9]{64}$/.test(args.output.revision))) ||
      (args.stream != null && !['stdout', 'stderr'].includes(args.stream)) ||
      (args.offset != null && (!Number.isSafeInteger(args.offset) || args.offset < 0)) ||
      (args.limit != null && (!Number.isSafeInteger(args.limit) || args.limit < 1 || args.limit > 32768)) ||
      (args.id == null && args.output == null &&
        ['stream', 'offset', 'limit'].some(key => args[key] != null)))
    return invalid('Invalid output reference or page');
  return args;
}

export function stop(args) {
  if (!object(args, ['id']) || typeof args.id !== 'string' || !args.id)
    return invalid('Command id is required');
  return args;
}

function byteLength(text) {
  return [...text].reduce((bytes, char) => {
    const value = char.codePointAt(0);
    return bytes + (value < 0x80 ? 1 : value < 0x800 ? 2 : value < 0x10000 ? 3 : 4);
  }, 0);
}

export function write(args) {
  if (!object(args, ['id', 'input']) || typeof args.id !== 'string' || !args.id ||
      typeof args.input !== 'string' || byteLength(args.input) > 65536)
    return invalid('Invalid command input');
  return args;
}

export function result({ output }) {
  const outcome = output.kind === 'command_result' ? output.data.outcome.kind : null;
  let blocks;
  if (output.kind === 'command_result' || output.kind === 'command_output') {
    blocks = ['stdout', 'stderr'].map(stream => {
      const capture = output.data[stream], notices = [];
      if (capture.truncated) notices.push(captions.truncated);
      if (capture.invalid_utf8) notices.push(captions.encoding);
      return {kind:'text',path:`/data/${stream}/text`,notices};
    });
  } else if (output.kind === 'command_started') {
    blocks = [{kind:'notice',message:captions.started}];
  } else if (output.kind === 'command_output_page' || output.kind === 'tool_output') {
    blocks = [{kind:'text',path:'/data/text',notices:[]}];
  }
  const result = blocks ? {...output,sailry_content:{version:1,blocks}} : output;
  // A nonzero exit is still a completed command with inspectable output.
  if (outcome === 'signal' || outcome === 'timed_out' || outcome === 'unknown') return { ...result, isError: true };
  return result;
}
