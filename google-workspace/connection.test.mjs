import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const manifest=JSON.parse(readFileSync(new URL('./plugin.json',import.meta.url)));
const extension=manifest.extensions['dev.sailry.platform'];
const source=readFileSync(new URL('./dev.sailry.platform/host/main.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const plain=value=>JSON.parse(JSON.stringify(value));
function adapter(){return vm.runInNewContext(`${source}\n({request})`,{readSettings:async()=>({values:{operator:'operator-id'}})}).request;}
function outcome(body,status=200){return {data:{status,headers:{},body:JSON.stringify(body)}};}
test('captures finite operations and origin-bound credentials',()=>{
 assert.deepEqual(extension.actions,['http.request']);
 assert.deepEqual(extension.tools[0].handler.flow.operations,['http.request']);
 assert.equal(extension.tools[0].handler.parameters.additionalProperties,false);
 for(const field of Object.values(JSON.parse(readFileSync(new URL('./dev.sailry.platform/settings.json',import.meta.url))).properties)){
  if(field['x-sailry-secret']) assert.equal(field.default,undefined);
 }
});

test('mail and document reads preserve paging and text',()=>{
 const request=adapter();
 const mail=plain(request({step:0,arguments:{action:'messages',query:'from:朋友@example.com',cursor:'next&token',limit:12}}));
 const url=new URL(mail.call.arguments.url);
 assert.equal(url.origin,'https://gmail.googleapis.com'); assert.equal(url.pathname,'/gmail/v1/users/me/messages');
 assert.equal(url.searchParams.get('q'),'from:朋友@example.com'); assert.equal(url.searchParams.get('pageToken'),'next&token');
 assert.equal(mail.call.arguments.credential,'gmail_token'); assert.equal(mail.call.arguments.method,'GET');
 const exportRead=request({step:0,arguments:{action:'export_doc',id:'doc/quoted?'}});
 assert.match(exportRead.call.arguments.url,/\/drive\/v3\/files\/doc%2Fquoted%3F\/export\?/);
 const result=plain(request({step:1,state:exportRead.state,outcome:{data:{status:200,body:'原文\nSecond paragraph'}}}));
 assert.deepEqual(result.result,{text:'原文\nSecond paragraph',untrusted:true});
 const page=plain(request({step:1,outcome:outcome({files:[{id:'one'}],nextPageToken:'next',incompleteSearch:true})}));
 assert.equal(page.result.next,'next'); assert.equal(page.result.partial,true); assert.equal(page.result.untrusted,true);
 assert.throws(()=>request({step:0,arguments:{action:'file',id:'..'}}));
});

test('preserves failures without replaying uncertain effects',async()=>{
 const request=adapter(); const uncertain={isError:true,error:{code:'outcome_unknown',message:'interrupted'}};
 assert.deepEqual(plain(await request({step:1,outcome:uncertain})),{result:uncertain});
 for(const reply of [{data:{status:200,body:'invalid'}},{data:{status:429,headers:{'retry-after':['12']},body:'private error body'}}]){
  const result=plain(await request({step:1,outcome:reply}));
  assert.equal(result.result.isError,true); assert.equal(result.call,undefined);
  assert.equal(JSON.stringify(result).includes('private error body'),false);
 }
});
