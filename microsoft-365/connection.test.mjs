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

test('keeps graph continuations on the captured resource',()=>{
 const request=adapter();
 const initial=request({step:0,arguments:{action:'messages',query:'report',limit:3}});
 const first=new URL(initial.call.arguments.url);
 assert.equal(first.origin,'https://graph.microsoft.com'); assert.equal(first.pathname,'/v1.0/me/messages');
 assert.equal(first.searchParams.get('$search'),'"report"');
 const next='https://graph.microsoft.com/v1.0/me/messages?$skiptoken=opaque%2Btoken';
 const page=plain(request({step:1,state:initial.state,outcome:outcome({value:[{id:'one'}],'@odata.nextLink':next})}));
 assert.equal(page.result.next,next);
 const continued=request({step:0,arguments:{action:'messages',cursor:next}});
 assert.equal(continued.call.arguments.url,next);
 for(const cursor of ['https://evil.test/v1.0/me/messages?token=x','https://graph.microsoft.com/v1.0/me/events?token=x',next+'#fragment'])
  assert.throws(()=>request({step:0,arguments:{action:'messages',cursor}}));
 const files=new URL(request({step:0,arguments:{action:'files',query:"O'Brien"}}).call.arguments.url);
 assert.equal(decodeURIComponent(files.pathname),"/v1.0/me/drive/root/search(q='O''Brien')");
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
