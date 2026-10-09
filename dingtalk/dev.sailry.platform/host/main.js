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
import {readSettings} from 'sailry/sdk';

export async function request(input) {
  const args = input.arguments ?? {};
  if (input.step === 0) {
    const settings = await readSettings();
    const operator = text(args.operator ?? settings.values.operator, 'operator');
    const values = {operatorId:operator,nextToken:args.cursor,maxResults:limit(args.limit)};
    let path;
    switch (args.action) {
      case 'workspaces': path = '/v2.0/wiki/mineWorkspaces'; delete values.nextToken; delete values.maxResults; break;
      case 'nodes': path = '/v2.0/wiki/nodes'; values.parentNodeId = text(args.parent, 'parent node'); break;
      case 'node':
        path = `/v2.0/wiki/nodes/${id(args.id)}`; delete values.nextToken; delete values.maxResults; break;
      case 'files':
        path = `/v1.0/drive/spaces/${id(args.space, 'space')}/files`;
        delete values.operatorId; values.unionId = operator; values.parentId = text(args.parent, 'parent file'); break;
      default: throw new Error('Unknown DingTalk action');
    }
    return call(`https://api.dingtalk.com${path}?${query(values)}`, 'token');
  }
  const reply = response(input.outcome);
  return {result:reply.error ?? {data:reply.value,next:reply.value.nextToken ?? null,
    partial:reply.value.hasMore === true,untrusted:true}};
}
