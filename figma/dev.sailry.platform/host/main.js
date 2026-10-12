const origin = 'https://api.figma.com';

function segment(value, name) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value))
    throw new Error(`Invalid ${name}`);
  return value;
}
function parameters(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)
      || Object.keys(args).some(key => !['action','file_key','ids','version','depth'].includes(key)))
    throw new Error('Invalid Figma arguments');
  if (!['file','nodes'].includes(args.action)) throw new Error('Unknown Figma action');
  const values = [];
  if (args.action === 'nodes') {
    if (!Array.isArray(args.ids) || !args.ids.length || args.ids.length > 100
        || new Set(args.ids).size !== args.ids.length
        || args.ids.some(id => typeof id !== 'string' || !id.length || id.length > 1024
          || /[\u0000-\u0020,]/.test(id))) throw new Error('Invalid node IDs');
    values.push(['ids', args.ids.join(',')]);
  } else if (args.ids !== undefined) throw new Error('Node IDs require the nodes action');
  if (args.version !== undefined) values.push(['version', segment(args.version, 'version')]);
  if (args.depth !== undefined) {
    if (!Number.isInteger(args.depth) || args.depth < 1 || args.depth > 100)
      throw new Error('Invalid depth');
    values.push(['depth', String(args.depth)]);
  }
  const query = values.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
  return `/v1/files/${segment(args.file_key, 'file key')}${args.action === 'nodes' ? '/nodes' : ''}${query ? `?${query}` : ''}`;
}
function failure(message, status = null) {
  return {isError:true, error:{code:'unavailable',message}, status};
}
export function read(input) {
  const args = input.arguments ?? {};
  if (input.step === 0) return {call:{operation:'http.request', arguments:{
    method:'GET', url:`${origin}${parameters(args)}`, headers:{Accept:'application/json'},
    body:null, credential:'token', timeout_ms:30000
  }}};
  if (input.outcome?.isError) return {result:input.outcome};
  const response = input.outcome?.data;
  if (!response || !Number.isInteger(response.status) || typeof response.body !== 'string')
    return {result:failure('Invalid HTTP response')};
  if (response.status < 200 || response.status >= 300)
    return {result:{...failure(`Figma request failed (${response.status})`, response.status),
      retry_after:response.headers?.['retry-after']?.[0] ?? null}};
  let value;
  try { value = JSON.parse(response.body); }
  catch { return {result:failure('Figma returned invalid JSON', response.status)}; }
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || (args.action === 'file' && (!value.document || typeof value.document !== 'object' || Array.isArray(value.document)))
      || (args.action === 'nodes' && (!value.nodes || typeof value.nodes !== 'object' || Array.isArray(value.nodes))))
    return {result:failure('Invalid Figma response', response.status)};
  const partial = args.depth !== undefined
    || (args.action === 'nodes' && Object.values(value.nodes).some(node => node === null));
  return {result:{data:value, untrusted:true, depth:args.depth ?? null, partial}};
}
