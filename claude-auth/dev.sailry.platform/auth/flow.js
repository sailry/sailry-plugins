// Adapted from Sailry's Pi-compatible flow (Pi 4270522473e677ddba7b093caa0064a3df51d459).
// Copyright (c) 2025 Mario Zechner. MIT license: LICENSE.pi.
const invalid=()=>({kind:'reject',code:'invalid_request'});
const text=value=>typeof value==='string'&&value.length>0&&value.length<=16384;
const request=(name,fields,state)=>({kind:'request',name,fields,state});
const query=(base,fields)=>`${base}?${Object.entries(fields).map(([key,value])=>`${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&')}`;
export function authorize({event,context,state,now_ms:now}) {
  const CLIENT=context.fields?.client_id;
  if (!text(CLIENT)) return invalid();
  if(event.kind==='refresh')return request('refresh',{refresh:context.previous?.refresh},{phase:'tokens'});
  if(event.kind==='start'){
    if(!text(context.redirect))return invalid();
    const fields={code:'true',client_id:CLIENT,response_type:'code',redirect_uri:context.redirect,scope:context.scopes.join(' '),code_challenge_method:'S256',code_challenge:context.proof.challenge,state:context.proof.verifier};
    return {kind:'prompt',url:query('https://claude.ai/oauth/authorize',fields),user_code:null,expires_at_ms:now+900000,state:{phase:'callback'}};
  }
  if(event.kind==='response'&&(event.status<200||event.status>=300))return {kind:'reject',code:[400,401,403].includes(event.status)?'permission_denied':'invalid_request'};
  switch(state?.phase){
    case 'callback':return {kind:'callback',proof:'verifier',allow_code:true,state:{phase:'returned'}};
    case 'returned':return request('token',{code:event.fields.code,state:context.proof.verifier,redirect_uri:context.redirect,verifier:context.proof.verifier},{phase:'tokens'});
    case 'tokens':{
      const body=event.body;
      if(!text(body?.access_token)||!text(body?.refresh_token)||!Number.isSafeInteger(body?.expires_in)||body.expires_in<0||!Number.isSafeInteger(now+body.expires_in*1000))return invalid();
      return {kind:'finish',grant:{kind:'claude_oauth',access:body.access_token,refresh:body.refresh_token,expires_at_ms:Math.max(0,now+body.expires_in*1000-300000),renewal_pending:false}};
    }
    default:return invalid();
  }
}
