function text(value, name, limit = 4096) {
  if (typeof value !== 'string' || !value.length || value.length > limit || /[\u0000-\u001f]/.test(value))
    throw new Error(`Invalid ${name}`);
  return value;
}
function encoded(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}
function id(value, name = 'identifier') {
  const segment = text(value, name, 1024);
  if (segment === '.' || segment === '..') throw new Error(`Invalid ${name}`);
  return encoded(segment);
}
function query(values) {
  return Object.entries(values).filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encoded(key)}=${encoded(String(value))}`).join('&');
}
function limit(value = 50) {
  if (!Number.isInteger(value) || value < 1 || value > 100) throw new Error('Invalid page size');
  return value;
}
function failure(message, status = null) {
  return {isError:true,error:{code:'unavailable',message},status};
}
function response(outcome) {
  if (outcome?.isError) return {error:outcome};
  const data = outcome?.data;
  if (!data || !Number.isInteger(data.status) || typeof data.body !== 'string')
    return {error:failure('Invalid HTTP response')};
  if (data.status < 200 || data.status >= 300)
    return {error:{...failure(`Service request failed (${data.status})`, data.status),
      retry_after:data.headers?.['retry-after']?.[0] ?? null}};
  try { return {value:JSON.parse(data.body)}; }
  catch { return {error:failure('Service returned invalid JSON', data.status)}; }
}
function call(url, credential, state = null) {
  return {call:{operation:'http.request',arguments:{method:'GET',url,
    headers:{Accept:'application/json'},body:null,credential,timeout_ms:30000}},state};
}
function repository(value) {
  const parts = text(value, 'repository', 1024).split('/');
  if (parts.length > 2 || parts.some(part => !part || part === '.' || part === '..'))
    throw new Error('Invalid repository');
  return parts.map(part => id(part)).join('/');
}
export function request(input) {
  const args = input.arguments ?? {};
  if (input.step === 0) {
    let path;
    switch (args.action) {
      case 'search':
        if (args.type !== undefined && !['doc','repo'].includes(args.type)) throw new Error('Invalid search type');
        path = `/search?${query({q:text(args.query, 'query'),type:args.type ?? 'doc',page:args.page ?? 1})}`; break;
      case 'repos': path = `/users/${id(args.user, 'user')}/repos?${query({offset:args.offset ?? 0})}`; break;
      case 'docs': path = `/repos/${repository(args.repo)}/docs`; break;
      case 'doc': path = `/repos/${repository(args.repo)}/docs/${id(args.id)}?raw=1`; break;
      case 'toc': path = `/repos/${repository(args.repo)}/toc`; break;
      default: throw new Error('Unknown Yuque action');
    }
    return call(`https://www.yuque.com/api/v2${path}`, 'token');
  }
  const reply = response(input.outcome);
  if (reply.error) return {result:reply.error};
  if (reply.value.data === undefined) return {result:failure('Invalid Yuque response')};
  return {result:{data:reply.value.data,meta:reply.value.meta ?? null,untrusted:true}};
}
