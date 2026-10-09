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
  if (!object(args,['path','old_text','new_text','replace_all','edits','expected_revision']) ||
      typeof args.path !== 'string' || !current(args.expected_revision)) return invalid();
  if (args.edits !== undefined) {
    if (args.old_text !== undefined || args.new_text !== undefined ||
        (args.replace_all !== undefined && args.replace_all !== false) ||
        !Array.isArray(args.edits) || args.edits.length < 1 || args.edits.length > 128 ||
        args.edits.some(change => !object(change,['old_text','new_text','replace_all']) ||
          typeof change.old_text !== 'string' || !change.old_text || typeof change.new_text !== 'string' ||
          (change.replace_all !== undefined && typeof change.replace_all !== 'boolean'))) return invalid();
    return {path:args.path,edits:args.edits,expected_revision:args.expected_revision};
  }
  if (typeof args.old_text !== 'string' || !args.old_text || typeof args.new_text !== 'string' ||
      (args.replace_all !== undefined && typeof args.replace_all !== 'boolean')) return invalid();
  return {path:args.path,old_text:args.old_text,new_text:args.new_text,
    ...(args.replace_all !== undefined ? {replace_all:args.replace_all} : {}),expected_revision:args.expected_revision};
}

function current(value) {
  return typeof value === 'string' && /^[0-9a-fA-F]{64}$/.test(value);
}

export function remove(args) {
  if (!object(args,['path','expected_revision']) || typeof args.path !== 'string' ||
      !current(args.expected_revision)) return invalid();
  return {path:args.path,expected_revision:args.expected_revision};
}

export function move(args) {
  if (!object(args,['path','destination','expected_revision']) || typeof args.path !== 'string' ||
      typeof args.destination !== 'string' || !current(args.expected_revision)) return invalid();
  return {path:args.path,destination:args.destination,expected_revision:args.expected_revision};
}

export function mkdir(args) {
  if (!object(args,['path']) || typeof args.path !== 'string') return invalid();
  return {path:args.path};
}

export function find(args) {
  if (!object(args,['globs','path','limit','offset']) || !Array.isArray(args.globs) || args.globs.length < 1 ||
      args.globs.length > 64 || args.globs.some(glob => typeof glob !== 'string' || !glob || glob.length > 4096)) return invalid();
  const {path = '',limit = 500,offset = 0} = args;
  if (typeof path !== 'string' || !Number.isSafeInteger(limit) || limit < 1 || limit > 500 ||
      !Number.isSafeInteger(offset) || offset < 0) return invalid();
  return {globs:args.globs,path:path === '.' ? '' : path,limit,offset};
}

export function search(args) {
  if (!object(args,['query','regex','case_sensitive','globs','path','mode','context','type','limit','offset','multiline'])) return invalid();
  const {query,regex = false,case_sensitive = false,globs = [],path = '',mode = 'content',context = 0,
    type = null,limit = 200,offset = 0,multiline = false} = args;
  if (typeof query !== 'string' || !query || query.length > 4096 || typeof regex !== 'boolean' ||
      typeof case_sensitive !== 'boolean' || !Array.isArray(globs) || globs.length > 64 ||
      globs.some(glob => typeof glob !== 'string' || glob.length > 4096) || typeof path !== 'string' ||
      !['content','files','count'].includes(mode) || !Number.isSafeInteger(context) || context < 0 || context > 5 ||
      (type !== null && typeof type !== 'string') || !Number.isSafeInteger(limit) || limit < 1 || limit > 200 ||
      !Number.isSafeInteger(offset) || offset < 0 || typeof multiline !== 'boolean') return invalid();
  return {query,regex,case_sensitive,globs,path:path === '.' ? '' : path,mode,context,type,limit,offset,multiline};
}

export function office(args) {
  if (!object(args,['path','offset'])) return invalid();
  const {path,offset = 0} = args;
  if (typeof path !== 'string' || !Number.isSafeInteger(offset) || offset < 0) return invalid();
  return {path,offset};
}
