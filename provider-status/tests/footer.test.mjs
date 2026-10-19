import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// Ordinary package logic only: I/O and the View host are explicit fixtures.
// Production module registration, rendering and Node authorization are not exercised.
const root = new URL('../dev.sailry.platform/',import.meta.url);
const plain = value => JSON.parse(JSON.stringify(value));
const state = (cursor='1',authentication='claude_oauth') => ({cursor,connected:true,provider:{
  id:'channel',revision:'9007199254740993',model:'selected',authentication,preset:null,
}});
const response = (used=12) => ({status:200,headers:{},body:JSON.stringify({five_hour:{utilization:used,resets_at:null}})});
const settle = async () => {for (let index=0;index<24;index++) await Promise.resolve();};
const deferred = () => {
  let resolve,reject;
  const promise = new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
};

async function fixture(initial=state()) {
  const requests=[],published=[],watches=[],sleeps=[],toasts=[],failures=[];
  let clock=1000;
  class Clock extends Date {static now() {return clock;}}
  const context = vm.createContext({Date:Clock});
  const modules = new Map();
  function synthetic(name,values) {
    const module = new vm.SyntheticModule(Object.keys(values),function () {
      for (const [key,value] of Object.entries(values)) this.setExport(key,value);
    },{context,identifier:name});
    modules.set(name,module);
  }
  synthetic('gpui-kit',{View:class {},div:()=>({})});
  synthetic('sailry',{context:()=>JSON.stringify({locale:'en'})});
  synthetic('sailry/sdk',{
    publishContributions:values=>published.push(plain(values)),
    requestProviderHttp:(...args)=>{const request={args:plain(args),...deferred()};requests.push(request);return request.promise;},
    faultCode:message=>{try{return JSON.parse(message).code;}catch{return 'failed';}},
  });
  synthetic('sailry/ui',{
    readModelContext:()=>plain(initial),
    nextModelContext:cursor=>{const next={cursor,...deferred()};watches.push(next);return next.promise;},
    toast:value=>toasts.push(plain(value)),
  });
  async function load(url) {
    const id=String(url);
    if (modules.has(id)) return modules.get(id);
    const pending = (async()=>{
      const module = new vm.SourceTextModule(await readFile(url,'utf8'),{context,identifier:id});
      await module.link((specifier,referrer)=>specifier.startsWith('.')
        ? load(new URL(specifier,referrer.identifier)) : modules.get(specifier));
      return module;
    })();
    modules.set(id,pending);
    return pending;
  }
  const module = await load(new URL('desktop/footer.js',root));
  await module.evaluate();
  const cx={notify(){},sleep:ms=>{const next={ms,...deferred()};sleeps.push(next);return next.promise;},
    spawn:callback=>{const promise=callback(cx);promise.catch(error=>failures.push(error));return promise;}};
  const view=new module.namespace.default();view.init({},cx);
  return {view,cx,requests,published,watches,sleeps,toasts,failures,
    latest:()=>published.at(-1)[0],advance:ms=>{clock+=ms;},
    async update(value) {watches.shift().resolve(plain(value));await settle();},
  };
}

test('shares one refresh owner across native adapters',async()=>{
  const setup=await fixture();
  assert.deepEqual(setup.requests[0].args,['channel','9007199254740993','usage',{}]);
  assert.equal(setup.latest().value,'0%');
  setup.sleeps.shift().resolve();await settle();
  assert.equal(setup.requests.length,1);
  setup.requests[0].resolve(response(20));await settle();
  assert.equal(setup.latest().value,'20%');
  assert.equal(setup.latest().details[0].progress,20);
  setup.advance(60000);setup.sleeps.shift().resolve();await settle();
  assert.equal(setup.requests.length,1);
  setup.advance(120000);setup.sleeps.shift().resolve();await settle();
  assert.equal(setup.requests.length,2);
  assert.equal(setup.sleeps.length,1);
  assert.deepEqual(setup.failures,[]);
});

test('discards late replies after provider or session changes',async()=>{
  const setup=await fixture();
  const changed=state('2','chat_gpt_oauth');changed.provider.id='another';changed.provider.model='gpt';
  await setup.update(changed);
  assert.equal(setup.latest().value,'0%');
  setup.requests[0].resolve(response(99));await settle();
  assert.equal(setup.latest().value,'0%');
  assert.equal(setup.requests.length,2);
  assert.equal(setup.requests[1].args[0],'another');
  setup.requests[1].resolve({status:200,body:JSON.stringify({rate_limit:{primary_window:{
    used_percent:30,limit_window_seconds:18000,reset_at:null}}})});await settle();
  assert.equal(setup.latest().value,'30%');
  await setup.update({...changed,cursor:'3'});
  assert.equal(setup.latest().value,'0%');
  assert.equal(setup.requests.length,3);
  await setup.update({cursor:'4',connected:false,provider:null});
  setup.requests[2].resolve(response(88));await settle();
  assert.equal(setup.latest().visible,false);
  assert.deepEqual(setup.latest().details,[]);
  assert.deepEqual(setup.toasts,[]);
});

test('clears values on revision changes and unsupported selections',async()=>{
  const setup=await fixture();setup.requests[0].resolve(response(10));await settle();
  const changed=state('2');changed.provider.revision='9007199254740994';
  await setup.update(changed);
  assert.equal(setup.latest().value,'0%');
  assert.equal(setup.requests[1].args[1],'9007199254740994');
  await setup.update(state('3','api_key'));
  assert.equal(setup.latest().visible,false);
  setup.requests[1].resolve(response(90));await settle();
  assert.equal(setup.latest().visible,false);
  assert.equal(setup.requests.length,2);
});

test('uses the same adapter for SIWC without assuming credentials',async()=>{
  const setup=await fixture(state('1','chat_gpt'));
  assert.equal(setup.requests.length,1);
  setup.requests[0].resolve({status:403,body:'{"error":{"message":"Fixture account not entitled"}}'});await settle();
  assert.equal(setup.toasts[0].message,'Fixture account not entitled');
  assert.equal(setup.latest().value,'0%');
  assert.deepEqual(setup.latest().details,[]);
});

test('reports errors once and retries only after the shared interval',async()=>{
  const setup=await fixture();
  setup.requests[0].reject(new Error(JSON.stringify({code:'permission_denied',message:'Private SDK diagnostic'})));
  await settle();
  assert.equal(setup.toasts[0].message,'Unable to read account usage');
  assert.ok(!JSON.stringify(setup.toasts).includes('Private SDK diagnostic'));
  setup.view.refresh(setup.cx);assert.equal(setup.requests.length,1);
  setup.advance(60000);setup.sleeps.shift().resolve();await settle();
  setup.requests[1].reject(new Error(JSON.stringify({code:'permission_denied'})));await settle();
  assert.equal(setup.toasts.length,1);
  setup.advance(60000);setup.sleeps.shift().resolve();await settle();
  setup.requests[2].resolve(response());await settle();
  assert.equal(setup.latest().value,'12%');
  assert.deepEqual(setup.failures,[]);
});

test('retains successful metrics when the same channel read fails',async()=>{
  const setup=await fixture();setup.requests[0].resolve(response(42));await settle();
  const saved=setup.latest();
  setup.advance(180000);setup.sleeps.shift().resolve();await settle();
  setup.requests[1].resolve({status:429,body:'{"error":{"message":"Fixture usage rate limited"}}'});
  await settle();
  assert.deepEqual(setup.latest(),saved);
  assert.equal(setup.toasts.length,1);
  assert.equal(setup.toasts[0].message,'Fixture usage rate limited');
  setup.advance(60000);setup.sleeps.shift().resolve();await settle();
  setup.requests[2].resolve({status:429,body:'{"error":{"message":"Fixture usage rate limited"}}'});
  await settle();
  assert.deepEqual(setup.latest(),saved);
  assert.equal(setup.toasts.length,1);
  const changed=state('2');changed.provider.revision='9007199254740994';
  await setup.update(changed);
  assert.equal(setup.latest().value,'0%');
  assert.deepEqual(setup.latest().details,[]);
});

test('does not query disconnected or unrelated contexts',async()=>{
  for (const initial of [{cursor:'1',connected:false,provider:null},state('1','plugin')]) {
    const setup=await fixture(initial);
    assert.deepEqual(setup.requests,[]);
    assert.equal(setup.latest().visible,false);
  }
});
