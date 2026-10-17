import {runtimeTest, validateSchema} from '../scripts/test-host.mjs';
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

test('reads original documents without guessing pagination',()=>{
 const request=adapter();
 const document=new URL(request({step:0,arguments:{action:'doc',repo:'owner/book',id:'entry/quoted'}}).call.arguments.url);
 assert.equal(document.origin,'https://www.yuque.com'); assert.equal(document.pathname,'/api/v2/repos/owner/book/docs/entry%2Fquoted');
 assert.equal(document.searchParams.get('raw'),'1');
 const page=plain(request({step:1,outcome:outcome({data:{body:'原始正文'},meta:{offset:4}})}));
 assert.equal(page.result.data.body,'原始正文'); assert.deepEqual(page.result.meta,{offset:4});
 assert.equal(page.result.untrusted,true);
 for(const repo of ['../secret','owner/../secret','owner/book/extra']) assert.throws(()=>request({step:0,arguments:{action:'docs',repo}}));
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


test('provides localized official credential guidance', () => {
  const schema = JSON.parse(readFileSync(new URL('./dev.sailry.platform/settings.json', import.meta.url)));
  assert.ok(schema.description.includes("https://www.yuque.com/settings/tokens"));
  assert.equal(Object.keys(schema['x-sailry-locales']).length, 10);
  for (const locale of Object.values(schema['x-sailry-locales']))
    assert.ok(locale.description.includes("https://www.yuque.com/settings/tokens"));
  assert.equal(schema.properties.token.default, undefined);
});

const targets = [
  {args:{action:'search',query:'guide'},required:['query']},
  {args:{action:'repos',user:'owner'},required:['user']},
  {args:{action:'docs',repo:'owner/book'},required:['repo']},
  {args:{action:'toc',repo:'owner/book'},required:['repo']},
  {args:{action:'doc',repo:'owner/book',id:'document'},required:['repo','id']},
];
test('action targets reach the handler with their required fields', () => {
  const request = adapter();
  for (const {args,required} of targets) {
    assert.equal(request({step:0,arguments:args}).call.operation,'http.request');
    for (const field of required) {
      const incomplete = {...args}; delete incomplete[field];
      assert.throws(() => request({step:0,arguments:incomplete}), `${args.action}: ${field}`);
    }
  }
});

runtimeTest('schema requires the target fields for each action', () => {
  const values = [{}, {action:'unknown'}], expected = [false,false];
  for (const {args,required} of targets) {
    values.push(args); expected.push(true);
    for (const field of required) {
      const incomplete = {...args}; delete incomplete[field];
      values.push(incomplete); expected.push(false);
    }
  }
  assert.deepEqual(validateSchema(extension.tools[0].handler.parameters,values),expected);
});
