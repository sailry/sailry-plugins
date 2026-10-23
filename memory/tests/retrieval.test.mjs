import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,entry,id,project,fault} from './store.mjs';

const settings={enabled:true,auto_write:true,context_bytes:8192,review_after_days:90};
const initialize=f=>f.main.initialize({tools:['search_memory'],project,resources:true});
const index=result=>result.instruction ? JSON.parse(result.instruction.split('Index:\n')[1]) : [];

for(const kind of ['index','search']) {
  test(`${kind} reads independent body pages concurrently`,async()=>{
    const f=await fixture(),held=[];
    f.seed(Array.from({length:6},(_,position)=>entry(position+1,`Preference ${position+1}`,{kind:'user'})));
    f.onRead=key=>key.startsWith('memory/body/')?new Promise(resolve=>held.push({key,resolve})):undefined;
    const loading=kind==='index'?f.retrieval.indexMemories(project):f.retrieval.searchMemories(project,'');
    for(let step=0;step<64&&held.length<3;step++)await Promise.resolve();
    assert.equal(held.length,3,'all unique pages start before any body page settles');
    assert.equal(new Set(held.map(entry=>entry.key)).size,3);
    for(const pending of [...held].reverse())pending.resolve();
    const result=await loading;assert.equal(result.length,6);
    assert.deepEqual(Array.from(result,value=>kind==='index'?value.id:value.summary.id),Array.from({length:6},(_,position)=>id(position+1)));
    assert.equal(f.prepared.length,0);assert.equal(f.completed.length,0);
  });
}

for (const change of ['body','delete','foreign']) {
  test(`initialization recaptures after a concurrent ${change} change`,async()=>{
    const f=await fixture();
    f.configure(settings);
    f.seed([entry(1,'Original preference',{kind:'user'})]);
    const current=await f.storage.readMemory(id(1));
    current.body='Current complete preference';
    const pending=change==='delete' ? await f.mutations.removeOperations(id(1),1)
      : await f.mutations.putOperations(change==='foreign' ? entry(2,'Foreign project',{project:id(9000)}) : current,change==='foreign' ? 0 : 1);
    f.onRead=key=>{if(key.startsWith('memory/body/')){f.onRead=null;f.apply(pending.operations);}};
    const result=index(await initialize(f));
    if (change==='delete') assert.deepEqual(result,[]);
    else {
      assert.equal(result.length,1);
      assert.equal(result[0].id,id(1));
      assert.equal(result[0].body,change==='body' ? current.body : 'Original preference');
      assert.equal(result[0].revision,change==='body' ? 2 : 1);
    }
    assert.equal(f.prepared.length,0);
    assert.equal(f.completed.length,0);
    assert.deepEqual(f.state.reads,[]);
  });
}

test('retries a head change while capturing metadata',async()=>{
  const f=await fixture();
  f.configure(settings);
  f.seed([entry(1,'Original preference',{kind:'user'})]);
  const current=await f.storage.readMemory(id(1));
  current.summary.title='Current title';
  const pending=await f.mutations.putOperations(current,1);
  let heads=0;
  f.onRead=key=>{if(key==='memory/catalog' && ++heads===2)f.apply(pending.operations);};
  assert.equal(index(await initialize(f))[0].title,current.summary.title);
  assert.equal(heads,5);
  assert.equal(f.prepared.length,0);
  assert.equal(f.completed.length,0);
});

test('defers a contended index without ending initialization',async()=>{
  const f=await fixture();
  f.configure(settings);
  f.seed([entry(1,'Original preference',{kind:'user'})]);
  let bodies=0;
  f.onRead=key=>{
    if(key.startsWith('memory/body/')) {
      const head=f.get('memory/catalog');
      f.store(head.key,head.value,String(BigInt(head.revision)+1n));
      bodies++;
    }
  };
  const output=await initialize(f);
  assert.match(output.instruction,/Index pending/);
  assert.equal(output.instruction.includes('Index:\n[]'),false);
  assert.equal(bodies,3);
  assert.equal(f.state.index_pending,true);
  assert.deepEqual(f.state.reads,[]);
  assert.equal(f.prepared.length,0);
  assert.equal(f.completed.length,0);
});

for (const code of ['cancelled','permission_denied','unavailable','internal']) {
  test(`preserves ${code} without retrying the read`,async()=>{
    const f=await fixture();
    f.configure(settings);
    f.seed([entry(1,'Original preference',{kind:'user'})]);
    let bodies=0;
    const original=fault(code,'Original failure');
    f.onRead=key=>{if(key.startsWith('memory/body/')){bodies++;throw original;}};
    await assert.rejects(initialize(f),error=>error===original);
    assert.equal(bodies,1);
    assert.equal(f.state,null);
  });
}

test('preserves invalid stored pages without retrying',async()=>{
  const f=await fixture();
  f.configure(settings);
  f.seed([entry(1,'Original preference',{kind:'user'})]);
  f.store('memory/body/0',{v:2,bodies:{}});
  let bodies=0;
  f.onRead=key=>{if(key.startsWith('memory/body/'))bodies++;};
  await assert.rejects(initialize(f),/memory storage is incompatible/);
  assert.equal(bodies,1);
  assert.equal(f.state,null);
  assert.equal(f.prepared.length,0);
  assert.equal(f.completed.length,0);
});
