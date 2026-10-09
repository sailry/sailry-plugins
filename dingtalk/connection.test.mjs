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

test('uses configured operator and preserves page tokens',async()=>{
 const request=adapter();
 const initial=await request({step:0,arguments:{action:'nodes',parent:'parent',cursor:'opaque+next',limit:7}});
 const url=new URL(initial.call.arguments.url);
 assert.equal(url.origin,'https://api.dingtalk.com'); assert.equal(url.pathname,'/v2.0/wiki/nodes');
 assert.equal(url.searchParams.get('operatorId'),'operator-id'); assert.equal(url.searchParams.get('parentNodeId'),'parent');
 assert.equal(url.searchParams.get('nextToken'),'opaque+next'); assert.equal(url.searchParams.get('maxResults'),'7');
 const file=await request({step:0,arguments:{action:'files',space:'space',parent:'folder',operator:'explicit'}});
 const files=new URL(file.call.arguments.url); assert.equal(files.pathname,'/v1.0/drive/spaces/space/files');
 assert.equal(files.searchParams.get('unionId'),'explicit'); assert.equal(files.searchParams.get('parentId'),'folder');
 const page=plain(await request({step:1,outcome:outcome({nodes:[{id:'one'}],nextToken:'tail',hasMore:true})}));
 assert.equal(page.result.next,'tail'); assert.equal(page.result.partial,true);
 await assert.rejects(request({step:0,arguments:{action:'node',id:'..'}}));
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
