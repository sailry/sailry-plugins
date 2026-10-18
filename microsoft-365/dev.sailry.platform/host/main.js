function text(value, name) {
  if (typeof value !== 'string' || !value.length || /[\u0000-\u001f]/.test(value))
    throw new Error(`Invalid ${name}`);
  return value;
}
function encoded(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}
function id(value, name = 'identifier') {
  const segment = text(value, name);
  if (segment === '.' || segment === '..') throw new Error(`Invalid ${name}`);
  return encoded(segment);
}
function query(values) {
  return Object.entries(values).filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encoded(key)}=${encoded(String(value))}`).join('&');
}
function limit(value = 50, maximum) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('limit must be a positive safe integer');
  return {requested_limit:value,page_size:Math.min(value,maximum)};
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
function next(value, path) {
  if (value === undefined || value === null || value === '') return null;
  const prefix = `https://graph.microsoft.com/v1.0${path}?`;
  if (typeof value !== 'string' || !value.startsWith(prefix)
      || /[\u0000-\u0020#]/.test(value)) throw new Error('Invalid Graph page cursor');
  return value;
}
export function request(input) {
  const args = input.arguments ?? {};
  if (input.step === 0) {
    let path;
    // Messages and calendarView support 1000; other lists use a local page budget.
    // https://learn.microsoft.com/en-us/graph/api/user-list-messages
    // https://learn.microsoft.com/en-us/graph/api/calendar-list-calendarview
    const pagination = limit(args.limit,args.action === 'files' ? 200 : 1000);
    const values = {'$top':pagination.page_size};
    switch (args.action) {
      case 'messages':
        path = '/me/messages'; values['$select'] = 'id,subject,from,receivedDateTime,bodyPreview,webLink';
        if (args.query) values['$search'] = JSON.stringify(text(args.query, 'query')); break;
      case 'message':
        return call(`https://graph.microsoft.com/v1.0/me/messages/${id(args.id)}`, 'token');
      case 'events':
        if (args.time_min || args.time_max) {
          path = '/me/calendarView'; values.startDateTime = text(args.time_min, 'start time');
          values.endDateTime = text(args.time_max, 'end time');
        } else path = '/me/events';
        break;
      case 'event': return call(`https://graph.microsoft.com/v1.0/me/events/${id(args.id)}`, 'token');
      case 'files':
        path = args.query ? `/me/drive/root/search(q='${id(text(args.query, 'query').replace(/'/g, "''"), 'query')}')` : '/me/drive/root/children';
        break;
      case 'file': return call(`https://graph.microsoft.com/v1.0/me/drive/items/${id(args.id)}`, 'token');
      default: throw new Error('Unknown Microsoft 365 action');
    }
    const cursor = next(args.cursor,path);
    const url = cursor ?? `https://graph.microsoft.com/v1.0${path}?${query(values)}`;
    // Continuations are opaque server URLs; do not rewrite their page size.
    return call(url, 'token', {path,...(cursor ? {} : {pagination})});
  }
  const reply = response(input.outcome);
  if (reply.error) return {result:reply.error};
  const cursor = next(reply.value['@odata.nextLink'], input.state?.path);
  return {result:{data:reply.value,next:cursor,partial:cursor !== null,untrusted:true,
    ...(input.state?.pagination ? {pagination:input.state.pagination} : {})}};
}
