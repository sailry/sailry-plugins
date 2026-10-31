import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,entry,id,project,fault} from './store.mjs';

const settings={enabled:true,auto_write:true,context_bytes:8192,review_after_days:90};
const initialize=(f,message=null)=>f.main.initialize({tools:['search_memory'],project,resources:true,message});
const section=(result,heading)=>(result.instruction.split('\n\n').find(part=>part.startsWith(heading)) ?? '').split('\n').slice(1);
const relevant=result=>section(result,'Relevant memories:').map(line=>JSON.parse(line));
const titles=result=>section(result,'Memories (title and ID):').concat(section(result,'Other memories (title and ID):'));
const statistics=f=>f.prepared.every(request=>request.operations.every(operation=>operation.data.key.startsWith('memory/recall/')));

for(const kind of ['search']) {
  test(`${kind} reads independent body pages concurrently`,async()=>{
    const f=await fixture(),held=[];
    f.seed(Array.from({length:6},(_,position)=>entry(position+1,`Preference ${position+1}`,{kind:'user'})));
    f.onRead=key=>key.startsWith('memory/body/')?new Promise(resolve=>held.push({key,resolve})):undefined;
    const loading=f.retrieval.searchMemories(project,'');
    for(let step=0;step<64&&held.length<3;step++)await Promise.resolve();
    assert.equal(held.length,3,'all unique pages start before any body page settles');
    assert.equal(new Set(held.map(entry=>entry.key)).size,3);
    for(const pending of [...held].reverse())pending.resolve();
    const result=await loading;assert.equal(result.length,6);
    assert.deepEqual(Array.from(result,value=>value.summary.id),Array.from({length:6},(_,position)=>id(position+1)));
    assert.equal(f.prepared.length,0);assert.equal(f.completed.length,0);
  });
}

test('index lists titles without reading bodies',async()=>{
  const f=await fixture();
  f.configure(settings);
  f.seed([entry(1,'First preference',{kind:'user',title:'First'}),entry(2,'Second fact',{title:'Second',updated_at_ms:5})]);
  const result=await initialize(f);
  assert.deepEqual(titles(result),[`- Second (${id(2)})`,`- First (${id(1)})`]);
  assert.deepEqual(relevant(result),[]);
  assert.equal(f.reads.some(key=>key.startsWith('memory/body/')),false);
  assert.equal(f.prepared.length,0);
});

for (const change of ['body','delete','foreign']) {
  test(`relevant recall recaptures after a concurrent ${change} change`,async()=>{
    const f=await fixture();
    f.configure(settings);
    f.seed([entry(1,'Original preference',{kind:'user'})]);
    const current=await f.storage.readMemory(id(1));
    current.body='Current complete preference';
    const pending=change==='delete' ? await f.mutations.removeOperations(id(1),1)
      : await f.mutations.putOperations(change==='foreign' ? entry(2,'Foreign project',{project:id(9000)}) : current,change==='foreign' ? 0 : 1);
    f.onRead=key=>{if(key.startsWith('memory/body/')){f.onRead=null;f.apply(pending.operations);}};
    const result=await initialize(f,'preference');
    if (change==='delete') assert.deepEqual(relevant(result),[]);
    else {
      const [value]=relevant(result);
      assert.equal(value.id,id(1));
      assert.equal(value.body,change==='body' ? current.body : 'Original preference');
      assert.equal(value.revision,change==='body' ? 2 : 1);
    }
    assert.deepEqual(titles(result),[]);
    assert.ok(statistics(f));
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
  assert.deepEqual(titles(await initialize(f)),[`- Current title (${id(1)})`]);
  assert.equal(heads,8);
  assert.equal(f.prepared.length,0);
  assert.equal(f.completed.length,0);
});

test('defers a contended index without ending initialization',async()=>{
  const f=await fixture();
  f.configure(settings);
  f.seed([entry(1,'Original preference',{kind:'user'})]);
  let heads=0;
  f.onRead=key=>{
    if(key==='memory/catalog') {
      const head=f.get('memory/catalog');
      f.store(head.key,head.value,String(BigInt(head.revision)+1n));
      heads++;
    }
  };
  const output=await initialize(f);
  assert.match(output.instruction,/Memory is changing; use search_memory/);
  assert.deepEqual(titles(output),[]);
  assert.equal(heads,21,"three bounded outer attempts");
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
    let heads=0;
    const original=fault(code,'Original failure');
    f.onRead=key=>{if(key==='memory/catalog'){heads++;throw original;}};
    await assert.rejects(initialize(f),error=>error===original);
    assert.equal(heads,1);
    assert.equal(f.state,null);
  });
}

test('relevance failures keep the index',async()=>{
  const f=await fixture();
  f.configure(settings);
  f.seed([entry(1,'Original preference',{kind:'user',title:'Preference'})]);
  f.onRead=key=>{if(key.startsWith('memory/body/'))throw fault('unavailable','Search failed');};
  const output=await initialize(f,'preference');
  assert.deepEqual(relevant(output),[]);
  assert.deepEqual(titles(output),[`- Preference (${id(1)})`]);
});

test('preserves invalid stored catalogs without retrying',async()=>{
  const f=await fixture();
  f.configure(settings);
  f.seed([entry(1,'Original preference',{kind:'user'})]);
  f.store('memory/catalog',{v:2,pages:{}});
  let heads=0;
  f.onRead=key=>{if(key==='memory/catalog')heads++;};
  await assert.rejects(initialize(f),/memory storage is incompatible/);
  assert.equal(heads,1);
  assert.equal(f.state,null);
  assert.equal(f.prepared.length,0);
  assert.equal(f.completed.length,0);
});
