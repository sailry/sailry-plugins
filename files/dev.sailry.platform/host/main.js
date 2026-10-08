// Argument policy from Sailry 5bfeaf05 plugins/builtin/files/agent and office/agent.rs.
// Confined file access, approval, revisions and execution remain in the Node.

function object(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every(key => keys.includes(key));
}

function invalid() {
  return {isError:true,error:{code:'invalid_request',message:'Invalid file tool arguments'}};
}

function revision(value) {
  return value === undefined || value === null || typeof value === 'string';
}

export function list(args) {
  if (!object(args,['path','cursor']) ||
      (args.path !== undefined && typeof args.path !== 'string')) return invalid();
  const {path = '',cursor = null} = args;
  if (cursor !== null && (!object(cursor,['revision','directory','name']) ||
      typeof cursor.revision !== 'string' || typeof cursor.directory !== 'boolean' ||
      typeof cursor.name !== 'string')) return invalid();
  return {path:path === '.' ? '' : path,after:cursor};
}

export function read(args) {
  if (!object(args,['path','offset','limit']) || typeof args.path !== 'string') return invalid();
  const {offset = 0,limit = 200} = args;
  if (!Number.isSafeInteger(offset) || offset < 0 ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 2000) return invalid();
  return {path:args.path,offset,limit};
}

export function write(args) {
  if (!object(args,['path','text','expected_revision']) || typeof args.path !== 'string' ||
      typeof args.text !== 'string' || !revision(args.expected_revision)) return invalid();
  return {path:args.path,text:args.text,expected_revision:args.expected_revision ?? null};
}

export function edit(args) {
  if (!object(args,['path','old_text','new_text','expected_revision']) ||
      typeof args.path !== 'string' || typeof args.old_text !== 'string' || !args.old_text ||
      typeof args.new_text !== 'string' || typeof args.expected_revision !== 'string' ||
      !/^[0-9a-fA-F]{64}$/.test(args.expected_revision)) return invalid();
  return {path:args.path,old_text:args.old_text,new_text:args.new_text,expected_revision:args.expected_revision};
}

export function find(args) {
  if (!object(args,['globs']) || !Array.isArray(args.globs) || args.globs.length < 1 ||
      args.globs.length > 64 || args.globs.some(glob => typeof glob !== 'string' || !glob || glob.length > 4096)) return invalid();
  return {globs:args.globs};
}

export function search(args) {
  if (!object(args,['query','regex','case_sensitive','globs'])) return invalid();
  const {query,regex = false,case_sensitive = false,globs = []} = args;
  if (typeof query !== 'string' || typeof regex !== 'boolean' ||
      typeof case_sensitive !== 'boolean' || !Array.isArray(globs) ||
      globs.some(glob => typeof glob !== 'string')) return invalid();
  return {query,regex,case_sensitive,globs};
}

export function office(args) {
  if (!object(args,['path','offset'])) return invalid();
  const {path,offset = 0} = args;
  if (typeof path !== 'string' || !Number.isSafeInteger(offset) || offset < 0) return invalid();
  return {path,offset};
}
