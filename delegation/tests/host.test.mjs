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
  assert.match(policy.initialized.instruction,/review \(Review\): Inspect changes/);
  assert.deepEqual(plain(policy.initialized.tools),['spawn_agent']);
  const args = {role:'review',task:'Review the change',title:'检查 🙂'};
  assert.deepEqual(plain(policy.prepare(args)),args);
  for (const role of ['unknown',undefined]) assert.equal(policy.prepare({...args,role}).isError,true);
  assert.equal(host().prepare({role:null,task:'Independent task'}).isError,undefined);
});
test('fresh default children accept omitted or null roles with any roster',()=>{
  for (const roles of [[],[{key:'review',name:'Review',description:'Inspect'}]]) {
    const policy = host(roles);
    for (const args of [{task:'第一轮：读取并总结'},{role:null,task:'第一轮：读取并总结'}]) {
      assert.deepEqual(plain(policy.prepare(args)),args);
    }
    const schema = policy.initialized.parameters.spawn_agent;
    assert.deepEqual(plain(schema.required),['task']);
    assert.match(policy.initialized.instruction,/omit role or use null/);
    assert.match(policy.initialized.instruction,/normally omit role to preserve its original role and frozen configuration/);
    if (roles.length) {
      assert.match(policy.initialized.instruction,/Choose a role from the admitted roster when it fits the delegated task/);
      assert.match(policy.initialized.instruction,/use its exact listed key and never invent a role/);
      assert.match(policy.initialized.instruction,/If no role fits, omit role or use null/);
      assert.deepEqual(plain(schema.properties.role.type),['string','null']);
      assert.deepEqual(plain(schema.properties.role.enum),['review',null]);
      assert.match(schema.properties.role.description,/review \(Review\): Inspect/);
      assert.match(schema.properties.role.description,/selection metadata only/);
    } else {
      assert.match(policy.initialized.instruction,/No delegation roles are configured: omit role or use null/);
      assert.equal(schema.properties.role.type,'null');
    }
    for(const role of ['unknown','',false,0]) assert.equal(policy.prepare({role,task:'Task'}).isError,true);
  }
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
    assert.equal(policy.prepare({...args,role:null}).isError,undefined);
  }
});
test('manifest and initialized schemas expose reuse consistently',async()=>{
  const manifest = JSON.parse(await readFile(new URL('../plugin.json',import.meta.url),'utf8'));
  const tool = manifest.extensions['dev.sailry.platform'].tools[0];
  assert.deepEqual(tool.handler.parameters.required,['task']);
  assert.equal(tool.handler.parameters.properties.session.type,'string');
  assert.match(tool.description,/new child inherits/);
  assert.match(tool.description,/Choose a role from the admitted roster when it fits the delegated task/);
  assert.match(tool.description,/use its exact listed key and never invent a role/);
  assert.match(tool.description,/If no role fits or the roster is empty, omit role or use null/);
  assert.match(tool.description,/session ID and normally omit role/);
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
