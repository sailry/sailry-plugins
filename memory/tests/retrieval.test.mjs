import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,entry,id,project} from './store.mjs';

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
