import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
const source = (await readFile(new URL('../dev.sailry.platform/host/roles.js',import.meta.url),'utf8')).replace(/^import .*\n/gm,'').replace(/^export /gm,'');
const plain = value => JSON.parse(JSON.stringify(value));
const id = '11111111-1111-4111-8111-111111111111';
function host(roles=[]) {
  return vm.runInNewContext(`${source}\n({list,add,edit,remove,apply})`,{listRoles:async()=>plain(roles),newId:()=>id});
}
test('new definitions use package defaults and native admission',()=>{
  const prepared = host().add({key:'review',name:'Review',instructions:'Inspect'});
  assert.deepEqual(plain(prepared),{expected_revision:'0',role:{id,revision:'0',key:'review',name:'Review',instructions:'Inspect',description:'',read_only:false,model:null,max_turns:null,skills:[],appearance:null}});
  assert.equal(host().add({key:'review',name:'Review',instructions:'Inspect',provider_config:{}}).isError,true);
});
test('edits retain omitted fields and exact large revisions',async()=>{
  const original = {id,revision:'9007199254740993',key:'review',name:'Review',instructions:'Inspect',description:'Purpose',read_only:true,model:null,max_turns:8,skills:['files:read'],appearance:{icon:'agent',color:'blue'}};
  const prepared = await host([original]).edit({id,expected_revision:original.revision,name:'Renamed'});
  assert.deepEqual(plain(prepared),{role:{...original,name:'Renamed'},expected_revision:original.revision});
  const changed = await host([original]).edit({id,expected_revision:'2',name:'Changed'});
  assert.equal(changed.error.code,'revision_conflict');
  assert.equal((await host().edit({id,expected_revision:'1',name:'Changed'})).error.code,'not_found');
  assert.equal((await host([original]).edit({id,expected_revision:9007199254740992,name:'Changed'})).isError,true);
});
test('removal and application cannot replace ownership or rebase',()=>{
  const tools = host();
  assert.deepEqual(plain(tools.remove({id,expected_revision:'3'})),{role:id,expected_revision:'3'});
  assert.deepEqual(plain(tools.apply({agents:[{id,revision:'3'}],expected_session_revision:'9007199254740993'})),{roles:[{id,revision:'3'}],expected_revision:'9007199254740993'});
  assert.deepEqual(plain(tools.apply({agents:[],expected_session_revision:'4'})),{roles:[],expected_revision:'4'});
  for(const args of [{agents:[],expected_session_revision:4},{agents:[],expected_session_revision:'04'},{agents:[],expected_session_revision:'4',session:'other'},{agents:[{id,revision:'3'},{id,revision:'3'}],expected_session_revision:'4'}]) assert.equal(tools.apply(args).isError,true);
  assert.equal(tools.remove({id,expected_revision:'0'}).isError,true);
});
test('listing uses only the public catalog service',async()=>{
  const agents = [{id,revision:'1',key:'review'}];
  assert.deepEqual(plain(await host(agents).list({})),{agents});
  assert.equal((await host(agents).list({session:'other'})).isError,true);
});

test('expanded rosters retain each selected reference',()=>{
  const agents=Array.from({length:33},(_,index)=>({id:`role-${index}`,revision:'1'}));
  const result=host().apply({agents,expected_session_revision:'4'});
  assert.deepEqual(plain(result.roles),agents);
});
