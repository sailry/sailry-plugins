import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {authorize} from '../dev.sailry.platform/auth/flow.js';
import {runtimeTest,translate,translationInput} from '../../scripts/test-host.mjs';
const now=1800000000000;
const context={previous:null,fields:{client_id:'9d1c250a-e61b-44d9-88ed-5944d1962f5e'},scopes:'org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload'.split(' '),redirect:'https://platform.claude.com/oauth/code/callback',proof:{verifier:'private-verifier',challenge:'public-challenge'}};
const step=(event,state=null,overrides={})=>authorize({event,state,context:{...context,...overrides},now_ms:now});
test('declares the existing callback and token contracts',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../plugin.json',import.meta.url),'utf8'));
 assert.equal(manifest.version,'0.1.1');
 const declaration=manifest.extensions['dev.sailry.platform'].model_auth[0];
 assert.equal(declaration.authentication,'claude_oauth');
 assert.deepEqual(declaration.flow.callback,{path:'/callback',redirect_uri:context.redirect,manual:true,allow_localhost:true});
 assert.equal('scope' in declaration.flow.requests.refresh.body.value,false);
 assert.equal(declaration.flow.requests.token.url,'https://platform.claude.com/v1/oauth/token');
});
test('keeps PKCE proof private and supports pasted codes',()=>{
 const prompt=step({kind:'start'});
 const url=new URL(prompt.url);
 assert.equal(url.searchParams.get('code_challenge'),context.proof.challenge);
 assert.equal(url.searchParams.get('state'),context.proof.verifier);
 assert.equal(url.searchParams.get('redirect_uri'),context.redirect);
 assert.equal(url.searchParams.get('client_id'),'9d1c250a-e61b-44d9-88ed-5944d1962f5e');
 assert.equal(step({kind:'presented'},prompt.state).allow_code,true);
 const exchange=step({kind:'callback',fields:{code:'private-code'}},{phase:'returned'});
 assert.equal(exchange.name,'token');
 assert.equal(exchange.fields.verifier,context.proof.verifier);
});
test('keeps rotation and expiry semantics',()=>{
 const result=step({kind:'response',status:200,body:{access_token:'access',refresh_token:'refresh',expires_in:3600}},{phase:'tokens'});
 assert.deepEqual(result,{kind:'finish',grant:{kind:'claude_oauth',access:'access',refresh:'refresh',expires_at_ms:now+3300000,renewal_pending:false}});
 assert.equal(step({kind:'refresh'},null,{previous:result.grant}).name,'refresh');
 for(const missing of ['access_token','refresh_token','expires_in']){
   const body={access_token:'access',refresh_token:'refresh',expires_in:3600};delete body[missing];
   assert.equal(step({kind:'response',status:200,body},{phase:'tokens'}).kind,'reject');
 }
});
test('keeps actual rejections outside token decoding',()=>{
 for(const status of [400,401,403])assert.equal(step({kind:'response',status,body:null},{phase:'tokens'}).code,'permission_denied');
 assert.equal(step({kind:'response',status:500,body:{access_token:'access'}},{phase:'tokens'}).kind,'reject');
});
runtimeTest('uses production private translation',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../plugin.json',import.meta.url),'utf8'));
 const declaration=manifest.extensions['dev.sailry.platform'].model_auth[0];
 let state=null;
 const call=async event=>{
   const input={event,state,context,now_ms:now};
   const report=translate(await translationInput(new URL('../',import.meta.url),declaration.flow.script,'authorize',input));
   assert.deepEqual(report.calls,[]);assert.deepEqual(report.result.Ok,authorize(input));
   state=report.result.Ok.state;return report.result.Ok;
 };
 assert.equal((await call({kind:'start'})).kind,'prompt');
 assert.equal((await call({kind:'presented'})).kind,'callback');
 assert.equal((await call({kind:'callback',fields:{code:'private-code'}})).name,'token');
 const result=await call({kind:'response',status:200,body:{access_token:'access',refresh_token:'refresh',expires_in:3600}});
 assert.equal(result.grant.kind,'claude_oauth');
});
