import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,entry,id,project} from './store.mjs';

const settings={enabled:true,auto_write:true,context_bytes:8192,review_after_days:90};
const plain=value=>JSON.parse(JSON.stringify(value));
async function setup(entries=[],message=null) {
  const f=await fixture(); f.configure(settings); f.seed(entries);
  await f.main.initialize({tools:['search_memory','save_memory'],project,resources:true,message,mode:'code'});
  return f;
}
const save=(f,args,state,step=0,outcome)=>f.main.save({arguments:args,step,state,outcome});
async function commit(f,prepared) {
  const outcome=f.apply(prepared.call.arguments.operations);
  return save(f,prepared.args,prepared.state,1,outcome);
}
const memories=f=>[...f.records.keys()].filter(key=>key.startsWith('memory/entry/'));

test('creates without a prior search',async()=>{
  const f=await setup();
  const args={kind:'user',title:'Indentation',body:'Use tabs in Go files'};
  const prepared=await save(f,args);
  assert.equal(prepared.call.operation,'storage.transaction');
  const done=await commit(f,{...prepared,args});
  assert.equal(done.result.receipt.action,'created');
  assert.equal(done.result.receipt.body,args.body);
  assert.equal(memories(f).length,1);
});

test('explains how to create or update',async()=>{
  const f=await setup();
  const create=await save(f,{kind:'user',title:'Indentation',body:'Use tabs',expected_revision:2});
  assert.match(create.result.error.message,/omit expected_revision to create/);
  const update=await save(f,{id:id(1),kind:'user',title:'Indentation',body:'Use tabs'});
  assert.match(update.result.error.message,/pass expected_revision from search_memory/);
});

test('returns similar memories without writing and grants their read authority',async()=>{
  const f=await setup([entry(1,'Use concise replies in Chinese',{kind:'user'})]);
  const done=await save(f,{kind:'user',title:'Replies',body:'use concise  replies'});
  assert.equal(done.call,undefined);
  const output=plain(done.result);
  assert.equal(output.status,'similar');
  assert.equal(output.saved,false);
  assert.match(output.hint,/Update one with its id and revision/);
  const existing=JSON.parse(output.existing[0].parts[0].text);
  assert.equal(existing.summary.id,id(1));
  assert.equal(existing.body,'Use concise replies in Chinese');
  assert.equal(f.prepared.length,0);
  await f.main.beforeModel({results:[{name:'save_memory',response:output}]});
  const update=await save(f,{id:id(1),expected_revision:1,kind:'user',title:'Replies',body:'Use concise replies in Chinese and English'});
  assert.equal(update.call.operation,'storage.transaction');
});

test('extends a shorter original in place',async()=>{
  const f=await setup([entry(1,'Use concise replies',{kind:'user'}),entry(2,'Run unit tests before commits')]);
  const args={kind:'user',title:'Reply style',body:'Use concise replies in Chinese'};
  const prepared=await save(f,args);
  assert.equal(prepared.state.id,id(1));
  assert.equal(prepared.state.mode,'extend');
  const done=await commit(f,{...prepared,args});
  assert.equal(done.result.receipt.action,'updated');
  assert.equal((await f.storage.readMemory(id(1))).body,args.body);
  assert.equal((await f.storage.readMemory(id(1))).summary.title,'Reply style');
  assert.equal(memories(f).length,2);
  assert.equal(f.get('memory/catalog').value.active,2);
});

test('distinct facts are created beside related memories',async()=>{
  const f=await setup([entry(1,'Use concise replies',{kind:'user'})]);
  const args={kind:'user',title:'Commit style',body:'Write commit subjects in the imperative mood without replies'};
  const prepared=await save(f,args);
  assert.notEqual(prepared.state.id,id(1));
  assert.equal(prepared.state.mode,'create');
  const done=await commit(f,{...prepared,args});
  assert.equal(done.result.receipt.action,'created');
  assert.equal(memories(f).length,2);
});
