import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
const source = (await readFile(new URL('../dev.sailry.platform/host/main.js',import.meta.url),'utf8')).replace(/^import .*\n/gm,'').replace(/^export /gm,'');
const plain = value => JSON.parse(JSON.stringify(value));
function host(roles = []) {
  let state;
  const functions = vm.runInNewContext(`${source}\n({initialize,prepare,result})`,{readTurnState:()=>state,stageTurnState:value=>state=value});
  const initialized = functions.initialize({tools:['spawn_agent'],roles});
  return {...functions,initialized};
}
test('the admitted roster controls selection and instructions',()=>{
  const policy = host([{key:'review',name:'Review',description:'Inspect changes'}]);
  assert.match(policy.initialized.instruction,/review: Inspect changes/);
  assert.deepEqual(plain(policy.initialized.tools),['spawn_agent']);
  const args = {role:'review',task:'Review the change',title:'检查 🙂'};
  assert.deepEqual(plain(policy.prepare(args)),args);
  for (const role of [null,'unknown',undefined]) assert.equal(policy.prepare({...args,role}).isError,true);
  assert.equal(host().prepare({role:null,task:'Independent task'}).isError,undefined);
});
test('reuse keeps role selection optional and validates session IDs',()=>{
  const session = '11111111-1111-4111-8111-111111111111';
  for(const roles of [[],[{key:'review',name:'Review',description:'Inspect'}]]) {
    const policy = host(roles), args = {session,task:'Continue the review'};
    assert.deepEqual(plain(policy.prepare(args)),args);
    assert.deepEqual(plain(policy.initialized.parameters.spawn_agent.required),['task']);
    assert.equal(policy.initialized.parameters.spawn_agent.properties.session.type,'string');
    for(const value of [null,undefined,'',123,'missing','../other']) {
      assert.equal(policy.prepare({...args,session:value}).isError,true);
    }
    assert.equal(policy.prepare({...args,role:'unknown'}).isError,true);
    assert.equal(policy.prepare({...args,role:roles.length ? 'review' : null}).isError,undefined);
    if(roles.length) assert.equal(policy.prepare({...args,role:null}).isError,true);
  }
});
test('manifest and initialized schemas expose reuse consistently',async()=>{
  const manifest = JSON.parse(await readFile(new URL('../plugin.json',import.meta.url),'utf8'));
  const tool = manifest.extensions['dev.sailry.platform'].tools[0];
  assert.deepEqual(tool.handler.parameters.required,['task']);
  assert.equal(tool.handler.parameters.properties.session.type,'string');
  assert.match(tool.description,/new child inherits/);
  assert.match(tool.description,/reuse an idle child/);
  assert.match(tool.description,/retains its own history/);
});
test('invalid titles, scopes and empty tasks never reach child admission',()=>{
  const policy = host(), base = {role:null,task:'Task'};
  for(const args of [{...base,title:'a\nb'},{...base,title:'😀'.repeat(81)},{...base,task:' '},{...base,worktree:'../other'},{...base,session:'elsewhere'}]) assert.equal(policy.prepare(args).isError,true);
  assert.equal(policy.prepare({...base,title:'😀'.repeat(80),worktree:'11111111-1111-4111-8111-111111111111'}).isError,undefined);
});
test('child outcomes remain authoritative, including literal failures',()=>{
  const policy = host(), failure = {error:{code:'outcome_unknown',message:'Literal error'},isError:true};
  assert.deepEqual(plain(policy.result({output:failure})),failure);
  const result = {session:'child',turn:'turn',status:'completed',response:'Ready'};
  assert.deepEqual(plain(policy.result({output:{kind:'delegation',data:result}})),result);
});
