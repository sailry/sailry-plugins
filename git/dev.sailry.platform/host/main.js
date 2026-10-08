// Argument policy from Sailry ef5e82ea's native Git tools.
function object(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every(key => keys.includes(key));
}

function target(value) { return value === undefined || value === null || typeof value === 'string'; }
function invalid() { return {isError:true,error:{code:'invalid_request',message:'Invalid Git arguments'}}; }

export function status(args) {
  if (!object(args,['worktree']) || !target(args.worktree)) return invalid();
  return {worktree:args.worktree ?? null};
}

export function diff(args) {
  if (!object(args,['worktree','path','scope']) || !target(args.worktree) ||
      typeof args.path !== 'string') return invalid();
  const scope = args.scope ?? 'all';
  if (!['all','staged','unstaged'].includes(scope) || args.scope === null) return invalid();
  return {worktree:args.worktree ?? null,path:args.path,scope};
}

export function log(args) {
  if (!object(args,['worktree','limit','cursor']) || !target(args.worktree)) return invalid();
  const {limit = 20,cursor = null} = args;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) return invalid();
  if (cursor !== null && (!object(cursor,['head','offset']) ||
      typeof cursor.head !== 'string' || !/^[0-9a-fA-F]{40}$/.test(cursor.head) ||
      !Number.isSafeInteger(cursor.offset) || cursor.offset < 0)) return invalid();
  return {worktree:args.worktree ?? null,limit,cursor};
}

function page(args) {
  const {offset = 0, limit = 200} = args;
  return Number.isSafeInteger(offset) && offset >= 0 &&
    Number.isSafeInteger(limit) && limit >= 1 && limit <= 500 &&
    Number.isSafeInteger(offset + limit);
}

export function show(args) {
  if (!object(args,['worktree','revision','path','offset','limit']) || !target(args.worktree) ||
      !page(args) || (args.revision !== undefined && typeof args.revision !== 'string') ||
      (args.path !== undefined && args.path !== null && typeof args.path !== 'string')) return invalid();
  const {revision = 'HEAD', path = null, offset = 0, limit = 200} = args;
  if (path === null && offset !== 0) return invalid();
  return {worktree:args.worktree ?? null,revision,path,offset,limit};
}

export function blame(args) {
  if (!object(args,['worktree','revision','path','offset','limit']) || !target(args.worktree) ||
      !page(args) || !target(args.revision) || typeof args.path !== 'string') return invalid();
  return {worktree:args.worktree ?? null,revision:args.revision ?? null,path:args.path,
    offset:args.offset ?? 0,limit:args.limit ?? 200};
}

export function changes(args) {
  if (!object(args,['worktree','target','cursor','limit']) || !target(args.worktree) ||
      !page({limit:args.limit})) return invalid();
  const cursor = args.cursor ?? null;
  const selected = args.target === undefined
    ? (cursor === null ? {kind:'worktree',data:{scope:'all'}} : null) : args.target;
  if ((selected === null) === (cursor === null) ||
      (selected !== null && !object(selected,['kind','data'])) ||
      (cursor !== null && (!object(cursor,['snapshot','after_path']) ||
        !object(cursor.snapshot,['target','metadata_revision']) || !target(cursor.after_path)))) return invalid();
  return {worktree:args.worktree ?? null,target:selected,cursor,limit:args.limit ?? 200};
}

export function change(args) {
  if (!object(args,['worktree','snapshot','path','expected_metadata_revision','expected_revision','offset','limit']) ||
      !target(args.worktree) || !page(args) || typeof args.path !== 'string' ||
      !object(args.snapshot,['target','metadata_revision']) ||
      typeof args.expected_metadata_revision !== 'string' || !target(args.expected_revision) ||
      ((args.offset ?? 0) > 0 && args.expected_revision == null)) return invalid();
  return {worktree:args.worktree ?? null,snapshot:args.snapshot,path:args.path,
    expected_metadata_revision:args.expected_metadata_revision,expected_revision:args.expected_revision ?? null,
    offset:args.offset ?? 0,limit:args.limit ?? 200};
}
