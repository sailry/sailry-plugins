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
export function request(input) {
  const args = input.arguments ?? {};
  if (input.step === 0) {
    const values = {pageToken:args.cursor,maxResults:limit(args.limit)};
    let path, origin = 'https://www.googleapis.com', credential = 'workspace_token';
    switch (args.action) {
      case 'messages':
        origin = 'https://gmail.googleapis.com'; credential = 'gmail_token';
        path = '/gmail/v1/users/me/messages'; values.q = args.query; break;
      case 'message':
        return call(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id(args.id)}?format=full`, 'gmail_token');
      case 'events':
        path = `/calendar/v3/calendars/${id(args.calendar ?? 'primary')}/events`;
        Object.assign(values,{q:args.query,timeMin:args.time_min,timeMax:args.time_max,singleEvents:true}); break;
      case 'event':
        return call(`https://www.googleapis.com/calendar/v3/calendars/${id(args.calendar ?? 'primary')}/events/${id(args.id)}`, credential);
      case 'files':
        path = '/drive/v3/files';
        delete values.maxResults;
        Object.assign(values,{q:args.query,pageSize:limit(args.limit),fields:'nextPageToken,incompleteSearch,files(id,name,mimeType,webViewLink,modifiedTime,description)'}); break;
      case 'file':
        return call(`https://www.googleapis.com/drive/v3/files/${id(args.id)}?fields=id%2Cname%2CmimeType%2CwebViewLink%2CmodifiedTime%2Cdescription`, credential);
      case 'export_doc':
        return call(`https://www.googleapis.com/drive/v3/files/${id(args.id)}/export?mimeType=text%2Fplain`, credential, {plain:true});
      default: throw new Error('Unknown Google Workspace action');
    }
    return call(`${origin}${path}?${query(values)}`, credential);
  }
  if (input.state?.plain && !input.outcome?.isError) {
    const value = input.outcome?.data;
    if (!value || typeof value.body !== 'string' || value.status < 200 || value.status >= 300)
      return {result:failure('Document export failed', value?.status ?? null)};
    return {result:{text:value.body,untrusted:true}};
  }
  const reply = response(input.outcome);
  return {result:reply.error ?? {data:reply.value,next:reply.value.nextPageToken ?? null,
    partial:reply.value.incompleteSearch === true,untrusted:true}};
}
