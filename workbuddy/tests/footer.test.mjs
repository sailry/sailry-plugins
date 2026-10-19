import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as credits from '../dev.sailry.platform/desktop/credits.js';
import {messages} from '../dev.sailry.platform/desktop/locales.js';

// These tests exercise package scheduling and SDK arguments, not native rendering.
const source=(await readFile(new URL('../dev.sailry.platform/desktop/footer.js',import.meta.url),'utf8'))
  .replace(/^import .*;\n/gm,'').replace(/^export default /gm,'').replace(/^export /gm,'');
const plain=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{
  let resolve,reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
};
const state=(cursor='1',overrides={})=>({cursor,connected:true,provider:{id:'channel',revision:'9007199254740993',model:'selected',
  preset:{source:{kind:'package',data:{name:'workbuddy'}},id:'china',route:null}},...overrides});
const response=(remaining=12)=>({status:200,headers:{},body:JSON.stringify({code:0,data:{Response:{Data:{Accounts:[
  {PackageName:'Actual package',CapacityRemain:remaining,CapacitySize:20},
]}}}})});
const settle=async()=>{for(let index=0;index<8;index++)await Promise.resolve();};

function fixture(initial=state()) {
  const requests=[],published=[],toasts=[],watches=[],sleeps=[],failures=[];
  const Controller=vm.runInNewContext(`${source}\nFooter`,{
    View:class {},div:()=>({}),context:()=>JSON.stringify({locale:'en'}),
    ...credits,messages,
    publishContributions:states=>published.push(plain(states)),
    readModelContext:()=>plain(initial),
    nextModelContext:cursor=>{const wait=deferred();watches.push({cursor,...wait});return wait.promise;},
    requestProviderHttp:(...args)=>{const wait=deferred();requests.push({args:plain(args),...wait});return wait.promise;},
    faultCode:message=>{try{return JSON.parse(message).code;}catch{return 'failed';}},
    toast:value=>toasts.push(plain(value)),
  });
  const cx={notify(){},sleep:ms=>{const wait=deferred();sleeps.push({ms,...wait});return wait.promise;},
    spawn:callback=>{const promise=callback(cx);promise.catch(error=>failures.push(error));return promise;}};
  const view=new Controller();view.init({},cx);
  return {view,cx,requests,published,toasts,watches,sleeps,failures,
    async update(value){watches.shift().resolve(plain(value));await settle();},
    latest:()=>published.at(-1)[0]};
}

test('queries the selected channel and refreshes without overlapping requests',async()=>{
  const setup=fixture();
  assert.equal(setup.requests.length,1);
  const [id,revision,request,input]=setup.requests[0].args;
  assert.deepEqual([id,revision,request],['channel','9007199254740993','credits']);
  assert.deepEqual(Object.keys(input).sort(),['begin','end']);
  assert.match(input.begin,/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(setup.latest().visible,true);
  assert.equal(setup.latest().value,'—');
  setup.sleeps.shift().resolve();await settle();
  assert.equal(setup.requests.length,1);
  setup.requests[0].resolve(response());await settle();
  assert.equal(setup.latest().value,'12');
  assert.ok(setup.latest().details.some(row=>row.progress===60));
  assert.equal(setup.sleeps[0].ms,60000);
  setup.sleeps.shift().resolve();await settle();
  assert.equal(setup.requests.length,2);
  setup.requests[1].resolve(response(10));await settle();
  assert.equal(setup.latest().value,'10');
  assert.deepEqual(setup.toasts,[]);
  assert.deepEqual(setup.failures,[]);
});

test('hides unrelated selections and discards replies from older contexts',async()=>{
  const setup=fixture();
  await setup.update(state('2',{provider:null}));
  assert.equal(setup.latest().visible,false);
  setup.requests[0].resolve(response(999));await settle();
  assert.equal(setup.latest().visible,false);
  assert.equal(setup.latest().value,'—');
  assert.equal(setup.requests.length,1);
  await setup.update(state('3'));
  assert.equal(setup.requests.length,2);
  const other=state('4');other.provider.model='another';other.provider.revision='9007199254740994';
  await setup.update(other);
  assert.equal(setup.latest().value,'—');
  assert.equal(setup.requests.length,2);
  setup.requests[1].resolve(response(888));await settle();
  assert.equal(setup.requests.length,3);
  assert.equal(setup.requests[2].args[1],'9007199254740994');
  assert.equal(setup.latest().value,'—');
  setup.requests[2].resolve(response(7));await settle();
  assert.equal(setup.latest().value,'7');
  assert.deepEqual(setup.failures,[]);
});

test('clears retained values on disconnection and a new context generation',async()=>{
  const setup=fixture();setup.requests[0].resolve(response());await settle();
  await setup.update(state('2',{connected:false,provider:null}));
  assert.equal(setup.latest().visible,false);
  assert.equal(setup.latest().value,'—');
  await setup.update(state('3'));
  assert.equal(setup.latest().visible,true);
  assert.equal(setup.latest().value,'—');
  setup.requests[1].resolve(response(8));await settle();
  await setup.update(state('4'));
  assert.equal(setup.latest().value,'—');
  assert.equal(setup.requests.length,3);
  assert.deepEqual(setup.failures,[]);
});

test('does not request another package or a disconnected channel',()=>{
  for(const initial of [state('1',{provider:null}),state('1',{connected:false})]) {
    const setup=fixture(initial);
    assert.deepEqual(setup.requests,[]);
    assert.equal(setup.latest().visible,false);
    assert.deepEqual(setup.failures,[]);
  }
});

test('reports safe errors once and recovers after a successful refresh',async()=>{
  const setup=fixture();
  const failure=new Error(JSON.stringify({code:'permission_denied',message:'Synthetic private diagnostic'}));
  setup.requests[0].reject(failure);await settle();
  assert.equal(setup.toasts.length,1);
  assert.equal(setup.toasts[0].message,messages('en').permission);
  assert.ok(!JSON.stringify(setup.toasts).includes('Synthetic private diagnostic'));
  setup.view.refresh(setup.cx);setup.requests[1].reject(failure);await settle();
  assert.equal(setup.toasts.length,1);
  setup.view.refresh(setup.cx);setup.requests[2].resolve(response());await settle();
  assert.equal(setup.latest().value,'12');
  setup.view.refresh(setup.cx);setup.requests[3].reject(failure);await settle();
  assert.equal(setup.toasts.length,2);
  assert.equal(setup.latest().value,'—');
  assert.deepEqual(setup.failures,[]);
});

test('keeps guarded provider messages without exposing ordinary SDK diagnostics',async()=>{
  const setup=fixture();
  setup.requests[0].resolve({status:429,headers:{},body:JSON.stringify({code:14018,message:'Actual account is unavailable'})});
  await settle();
  assert.equal(setup.toasts.length,1);
  assert.equal(setup.toasts[0].message,'Actual account is unavailable');
  assert.equal(setup.latest().value,'—');
  assert.deepEqual(setup.failures,[]);
});


test('uses a localized failure when the provider has no display message',async()=>{
  const setup=fixture();
  setup.requests[0].resolve({status:503,headers:{},body:'upstream transport unavailable'});await settle();
  assert.equal(setup.toasts.length,1);
  assert.equal(setup.toasts[0].message,messages('en').failed);
  assert.equal(setup.latest().value,'—');
  assert.deepEqual(setup.failures,[]);
});

test('does not toast failures for a replaced selection',async()=>{
  const setup=fixture();await setup.update(state('2',{provider:null}));
  setup.requests[0].reject(new Error('Late SDK diagnostic'));await settle();
  assert.deepEqual(setup.toasts,[]);
  assert.equal(setup.latest().visible,false);
  assert.deepEqual(setup.failures,[]);
});
