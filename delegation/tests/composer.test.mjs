import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {messages} from '../dev.sailry.platform/desktop/locales.js';

const source=(await readFile(new URL('../dev.sailry.platform/desktop/composer.js',import.meta.url),'utf8'))
  .replace(/^import .*;\n/gm,'').replace('export default class ','class ');
const plain=value=>JSON.parse(JSON.stringify(value));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function channel() {
  let resolve;
  return {next:()=>new Promise(done=>{resolve=done;}),send(value){assert.ok(resolve);resolve(value);}};
}
async function fixture(overrides={},save) {
  let state={cursor:'1',session:'parent',connected:true,readonly:false,busy:false,configuring:false,
    model_tools:true,operations:['agents.delegate'],options:{proactive:false},...overrides};
  const changes=channel(),events=channel(),contributions=[],calls=[],notices=[];
  const Type=vm.runInNewContext(`${source}\nComposer`,{
    View:class{},div:()=>({}),context:()=>'{"locale":"en"}',messages,
    readComposer:()=>plain(state),nextComposerChange:changes.next,nextContributionEvent:events.next,
    publishContributions:values=>contributions.push(plain(values[0])),toast:value=>notices.push(value),
    setComposerOption:async(cursor,key,value)=>{
      calls.push(plain({cursor,key,value}));
      if(save) return save();
      state={...state,cursor:String(BigInt(state.cursor)+1n),options:{...state.options,[value.key]:value.value}};
      return plain(state);
    },
  });
  const cx={notify(){},spawn(action){return action(cx);}},view=new Type();
  view.init({},cx);await tick();
  return {view,calls,notices,contributions,last:()=>contributions.at(-1),
    async event(value){events.send({id:'super',sequence:7,kind:'change',value});await tick();await tick();},
    async change(value){state=value;changes.send(plain(value));await tick();},
  };
}

test('toggle commits its own option and publishes the confirmed marker',async()=>{
  const f=await fixture();
  assert.equal(f.last().enabled,true);
  assert.equal(f.last().value,false);
  assert.deepEqual(f.last().segments,[]);
  await f.event(true);
  assert.deepEqual(f.calls,[{cursor:'1',key:'plugin',value:{key:'proactive',value:true}}]);
  assert.equal(f.last().value,true);
  assert.deepEqual(f.last().segments,[{label:{label:'super'},tone:'accent'}]);
  assert.equal(f.last().reply_to,7);
});

test('unavailable or blocked composers never submit changes',async()=>{
  for(const state of [{connected:false},{readonly:true},{busy:true},{configuring:true},{model_tools:false},{operations:[]}]) {
    const f=await fixture(state);
    assert.equal(f.last().enabled,false);
    await f.event(true);
    assert.deepEqual(f.calls,[]);
    assert.equal(f.last().reply_to,7);
  }
});

test('late completions cannot change another conversation',async()=>{
  let finish;
  const f=await fixture({},()=>new Promise(resolve=>{finish=resolve;}));
  await f.event(true);
  assert.equal(f.last().enabled,false);
  assert.equal(f.last().value,false);
  await f.change({...plain(f.view.state),cursor:'3',session:'other'});
  finish({...plain(f.view.state),cursor:'4',session:'parent',options:{proactive:true}});
  await tick();await tick();
  assert.equal(f.view.state.session,'other');
  assert.equal(f.last().value,false);
  assert.deepEqual(f.last().segments,[]);
  assert.deepEqual(f.notices,[]);
});

test('failed saves preserve observed values and release the interaction',async()=>{
  const f=await fixture({},async()=>{throw new Error('revision_conflict');});
  await f.event(true);
  assert.equal(f.last().value,false);
  assert.equal(f.last().enabled,true);
  assert.equal(f.last().reply_to,7);
  assert.equal(f.notices.length,1);
});
