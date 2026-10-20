// Existing Sailry SIWC and Codex protocols, executed by the shared private auth host.
const CODEX_REDIRECT = 'https://auth.openai.com/deviceauth/callback';
const RESOURCE = 'https://api.openai.com/v1';
const invalid = () => ({kind:'reject',code:'invalid_request'});
const denied = () => ({kind:'reject',code:'permission_denied'});
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 16384 && !/[\x00-\x1f\x7f-\x9f]/.test(value);
const client = value => typeof value === 'string' && value.length <= 256 && /^[A-Za-z0-9_-]+$/.test(value) && value !== 'dynamic_agent_client';
const request = (name,fields,state) => ({kind:'request',name,fields,state});
const wait = state => ({kind:'wait',delay_ms:state.interval_ms,state});
const expires = (now,seconds) => Number.isSafeInteger(seconds) && seconds > 0 && Number.isSafeInteger(now+seconds*1000) ? now+seconds*1000 : null;
const query = (base,fields) => `${base}?${Object.entries(fields).map(([key,value])=>`${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&')}`;
function error(event) {
  if (event.kind !== 'response' || event.status >= 200 && event.status < 300) return null;
  return event.status === 410 ? {kind:'reject',code:'expired'} : [400,401,403].includes(event.status) ? denied() : invalid();
}
function finish(kind,tokens,claims,context,now,selectedClient,refreshing=false) {
  const previous=refreshing ? context.previous : null;
  const expiry=expires(now,tokens.expires_in);
  if (!text(tokens.access_token) || expiry === null || !text(claims.sub)) return invalid();
  if (tokens.token_type != null && (typeof tokens.token_type !== 'string' || tokens.token_type.toLowerCase() !== 'bearer')) return invalid();
  const refresh=tokens.refresh_token ?? previous?.refresh;
  const identity=tokens.id_token ?? previous?.id_token;
  if (!text(refresh) || !text(identity)) return invalid();
  if (claims.chatgpt_account_id != null && typeof claims.chatgpt_account_id !== 'string' || claims['https://api.openai.com/auth'] != null && (typeof claims['https://api.openai.com/auth'] !== 'object' || Array.isArray(claims['https://api.openai.com/auth'])) || claims['https://api.openai.com/auth']?.chatgpt_account_id != null && typeof claims['https://api.openai.com/auth'].chatgpt_account_id !== 'string') return invalid();
  const account=claims.chatgpt_account_id ?? claims['https://api.openai.com/auth']?.chatgpt_account_id ?? null;
  const email=text(claims.email) && claims.email.length <= 1024 && claims.email.trim() ? claims.email.trim() : null;
  const grant={kind,access:tokens.access_token,refresh,expires_at_ms:expiry,subject:claims.sub,email,id_token:identity,renewal_pending:false};
  if (kind === 'chat_gpt_oauth') {
    if (!text(account)) return invalid();
    grant.account_id=account;
    if (previous && (previous.subject !== grant.subject || previous.account_id !== account)) return denied();
  } else {
    if (typeof tokens.token_type !== 'string' || tokens.token_type.toLowerCase() !== 'bearer' || !text(tokens.refresh_token) || !client(selectedClient)) return invalid();
    if (tokens.scope != null && typeof tokens.scope !== 'string') return invalid();
    const scopes=typeof tokens.scope === 'string' ? [...new Set(tokens.scope.split(/[\t\n\f\r ]+/).filter(Boolean))].sort() : previous?.scopes;
    if (!Array.isArray(scopes)) return invalid();
    Object.assign(grant,{client_id:selectedClient,scopes,earliest_refresh_at:tokens.earliest_refresh_at ?? null});
    if (account !== null || previous?.account_id != null) grant.account_id=account ?? previous.account_id;
    if (previous && previous.subject !== grant.subject) return denied();
  }
  return {kind:'finish',grant};
}
function verified(kind,event,state,context,now) {
  if (event.kind === 'identity') return finish(kind,state.tokens,event.claims,context,now,state.client_id,state.refreshing===true);
  const tokens=event.body;
  if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) return invalid();
  if (text(tokens.id_token)) return {kind:'verify',token:tokens.id_token,audience:state.client_id,nonce:state.nonce ?? null,state:{...state,tokens}};
  if (!context.previous || !state.refreshing) return invalid();
  return finish(kind,tokens,{sub:context.previous.subject,email:context.previous.email,chatgpt_account_id:context.previous.account_id},context,now,state.client_id,state.refreshing===true);
}
// Device tokens come from the declared TLS/PKCE exchange. Claims are metadata,
// not authority: they never select an issuer, client, endpoint or permission.
function metadata(token) {
  if (!text(token)) return null;
  const parts=token.split('.');
  if (parts.length !== 3 || parts.some(part=>!part || !/^[A-Za-z0-9_-]+$/.test(part))) return null;
  const payload=parts[1];
  if (payload.length % 4 === 1) return null;
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let bits=0,buffer=0,encoded='';
  for (const character of payload) {
    buffer=(buffer<<6)|alphabet.indexOf(character);
    bits+=6;
    if (bits>=8) {
      bits-=8;
      encoded+=`%${((buffer>>bits)&255).toString(16).padStart(2,'0')}`;
      buffer&=(1<<bits)-1;
    }
  }
  if (buffer !== 0) return null;
  try {
    const claims=JSON.parse(decodeURIComponent(encoded));
    return claims && typeof claims === 'object' && !Array.isArray(claims) ? claims : null;
  } catch { return null; }
}
function deviceTokens(event,state,context,now) {
  if (event.kind !== 'response') return invalid();
  const tokens=event.body;
  if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) return invalid();
  if (tokens.id_token != null) {
    const claims=metadata(tokens.id_token);
    return claims ? finish('chat_gpt_oauth',tokens,claims,context,now,state.client_id,state.refreshing===true) : invalid();
  }
  if (!context.previous || !state.refreshing) return invalid();
  return finish('chat_gpt_oauth',tokens,{sub:context.previous.subject,email:context.previous.email,chatgpt_account_id:context.previous.account_id},context,now,state.client_id,state.refreshing===true);
}
export function codex({event,context,state,now_ms:now}) {
  const CLIENT=context.fields?.client_id;
  if (!client(CLIENT)) return invalid();
  if (event.kind === 'start') return request('device',{client_id:CLIENT},{phase:'device',client_id:CLIENT});
  if (event.kind === 'refresh') return request('refresh',{client_id:CLIENT,refresh:context.previous?.refresh},{phase:'tokens',client_id:CLIENT,refreshing:true});
  if (state?.phase === 'poll' && event.kind === 'response') {
    const code=typeof event.body?.error === 'string' ? event.body.error : event.body?.error?.code;
    if ([403,404].includes(event.status) || event.status >= 300 && ['deviceauth_authorization_pending','slow_down'].includes(code)) {
      const interval_ms=state.interval_ms+(code === 'slow_down' ? 5000 : 0);
      return Number.isSafeInteger(interval_ms) ? wait({...state,interval_ms}) : invalid();
    }
  }
  const failed=error(event); if (failed) return failed;
  switch (state?.phase) {
    case 'device': {
      const body=event.body;
      if (body?.user_code !== undefined && body?.usercode !== undefined) return invalid();
      const userCode=body?.user_code ?? body?.usercode;
      if (body?.expires_in != null && (!Number.isSafeInteger(body.expires_in) || body.expires_in < 0)) return invalid();
      const duration=body?.expires_in == null ? 900 : Math.min(body.expires_in,900);
      if (duration === 0) return {kind:'reject',code:'expired'};
      const expiry=expires(now,duration);
      if (!text(body?.device_auth_id) || !text(userCode) || userCode.length > 64 || !/^[A-Za-z0-9-]+$/.test(userCode) || expiry === null) return invalid();
      const parsed=typeof body.interval === 'number' || typeof body.interval === 'string' && /^\+?\d+$/.test(body.interval.trim()) ? Number(body.interval) : 5;
      const interval_ms=(Number.isSafeInteger(parsed) && parsed >= 0 ? Math.max(1,Math.min(parsed,900)) : 5)*1000;
      return {kind:'prompt',url:'https://auth.openai.com/codex/device',user_code:userCode,expires_at_ms:expiry,state:{phase:'presented',device_auth_id:body.device_auth_id,user_code:userCode,interval_ms,client_id:CLIENT}};
    }
    case 'presented': return wait({...state,phase:'poll'});
    case 'poll':
      if (event.kind === 'elapsed') return request('poll',{device_auth_id:state.device_auth_id,user_code:state.user_code},state);
      if (!text(event.body?.authorization_code) || !text(event.body?.code_verifier)) return invalid();
      return request('token',{client_id:CLIENT,redirect_uri:CODEX_REDIRECT,code:event.body.authorization_code,verifier:event.body.code_verifier},{phase:'tokens',client_id:CLIENT});
    case 'tokens': return deviceTokens(event,state,context,now);
    default: return invalid();
  }
}
export function siwc({event,context,state,now_ms:now}) {
  if (event.kind === 'refresh') {
    const selected=context.previous?.client_id;
    return client(selected) ? request('refresh',{client_id:selected,refresh:context.previous.refresh,resource:RESOURCE},{phase:'tokens',client_id:selected,refreshing:true}) : invalid();
  }
  if (event.kind === 'start') {
    const selected=context.previous?.client_id ?? context.registration ?? null;
    if (selected !== null && !client(selected) || !text(context.host_id) || !text(context.redirect)) return invalid();
    const fields={client_id:selected ?? 'dynamic_agent_client',ext_agent_host_id:context.host_id,redirect_uri:context.redirect,response_type:'code',scope:context.scopes.join(' '),resource:RESOURCE,state:context.proof.state,nonce:context.proof.nonce,code_challenge_method:'S256',code_challenge:context.proof.challenge};
    if (selected === null) fields.agent_name_hint='Sailry';
    return {kind:'prompt',url:query('https://auth.openai.com/api/accounts/authorize',fields),user_code:null,expires_at_ms:now+900000,state:{phase:'callback',client_id:selected}};
  }
  const failed=error(event); if (failed) return failed;
  switch (state?.phase) {
    case 'callback': return {kind:'callback',proof:'state',allow_code:false,state:{...state,phase:'returned'}};
    case 'returned': {
      const selected=event.fields.client_id ?? state.client_id;
      if (!client(selected) || state.client_id !== null && selected !== state.client_id) return invalid();
      return {kind:'registered',client_id:selected,state:{phase:'registered',client_id:selected,code:event.fields.code}};
    }
    case 'registered': return request('token',{client_id:state.client_id,redirect_uri:context.redirect,resource:RESOURCE,code:state.code,verifier:context.proof.verifier},{phase:'tokens',client_id:state.client_id,nonce:context.proof.nonce});
    case 'tokens': return verified('chat_gpt',event,state,context,now);
    default: return invalid();
  }
}
