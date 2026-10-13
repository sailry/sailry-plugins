import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
const source = (await readFile(new URL('../dev.sailry.platform/host/main.js',import.meta.url),'utf8')).replace(/^import .*\n/gm,'').replace(/^export \{.*\n/gm,'').replace(/^export /gm,'');
const plain = value => JSON.parse(JSON.stringify(value));
function host(roles = []) {
  let state;
  const functions = vm.runInNewContext(`${source}\n({initialize,prepare,result})`,{readTurnState:()=>state,stageTurnState:value=>state=value});
  const initialized = functions.initialize({tools:['spawn_agent'],roles});
  return {...functions,initialized};
}
test('explicit constraints describe exploration independently of editable role names',()=>{
  const policy = host([{key:'renamed',name:'Customized',description:'Inspect sources',read_only:true}]);
  assert.match(policy.initialized.instruction,/renamed \(Customized\) \[read only\]: Inspect sources/);
  assert.match(policy.initialized.parameters.spawn_agent.properties.role.description,/\[read only\]/);
  assert.equal(policy.prepare({role:'renamed',task:'Inspect'}).isError,undefined);
});
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
    assert.ok(!policy.initialized.instruction.includes('Choose a role'));
    assert.ok(!policy.initialized.instruction.includes('frozen configuration'));
    if (roles.length) {
      assert.match(policy.initialized.instruction,/Configured delegation roles/);
      assert.match(policy.initialized.instruction,/review \(Review\): Inspect/);
      assert.deepEqual(plain(schema.properties.role.type),['string','null']);
      assert.deepEqual(plain(schema.properties.role.enum),['review',null]);
      assert.match(schema.properties.role.description,/review \(Review\): Inspect/);
      assert.match(schema.properties.role.description,/selection metadata only/);
    } else {
      assert.match(policy.initialized.instruction,/No delegation roles are configured/);
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
  const tool = manifest.extensions['dev.sailry.platform'].tools.find(tool => tool.name === 'spawn_agent');
  assert.deepEqual(tool.handler.parameters.required,['task']);
  assert.equal(tool.handler.parameters.properties.session.type,'string');
  assert.match(tool.description,/new child inherits/);
  assert.match(tool.description,/Choose a role from the roles listed in this tool when it fits the delegated task/);
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
test('background mode retains synchronous default and exposes child control',async()=>{
  const policy = host(), base = {task:'Independent work'};
  assert.deepEqual(plain(policy.prepare(base)),base);
  assert.deepEqual(plain(policy.prepare({...base,background:true})),{...base,background:true});
  assert.deepEqual(plain(policy.prepare({...base,background:false})),{...base,background:false});
  for(const background of [null,0,'true',undefined]) assert.equal(policy.prepare({...base,background}).isError,true);
  assert.equal(policy.initialized.parameters.spawn_agent.properties.background.type,'boolean');
  const manifest = JSON.parse(await readFile(new URL('../plugin.json',import.meta.url),'utf8'));
  const tools = manifest.extensions['dev.sailry.platform'].tools;
  const spawn = tools.find(tool => tool.name === 'spawn_agent');
  assert.equal(spawn.handler.parameters.properties.background.type,'boolean');
  assert.match(spawn.description,/Use guide_agent for new directions and wait_agent/);
  assert.match(spawn.description,/child does not see this conversation/);
  assert.match(spawn.description,/self-contained task with the goal, relevant paths, constraints and expected output/);
  assert.match(spawn.description,/disjoint files/);
  assert.equal(tools.find(tool => tool.name === 'guide_agent').operation,'agents.guide');
  assert.equal(tools.find(tool => tool.name === 'wait_agent').operation,'agents.wait');
});

test('child control summaries request canonical session titles',async()=>{
  const manifest = JSON.parse(await readFile(new URL('../plugin.json',import.meta.url),'utf8'));
  const tools = manifest.extensions['dev.sailry.platform'].tools;
  assert.deepEqual(tools.find(tool => tool.name === 'wait_agent').display.input.summary,
    {path:'/session',format:'session'});
  assert.deepEqual(tools.find(tool => tool.name === 'guide_agent').display.input.summary,{path:'/session',format:'session'});
  assert.deepEqual(tools.find(tool => tool.name === 'spawn_agent').display.input.summary,{path:'/title'});
});

test('comparison skill matches independent worktree implementations',async()=>{
  const skill = await readFile(new URL('../skills/compare-worktrees/SKILL.md',import.meta.url),'utf8');
  assert.match(skill,/description: Implement two or more competing approaches/);
  assert.match(skill,/independent subagents in separate registered worktrees/);
  assert.match(skill,/followed by comparison or a recommendation/);
  assert.match(skill,/Compose available worktree, delegation, Git and test tools/);
  assert.match(skill,/If the request is only a question, compare the approaches directly without creating worktrees/);
  assert.ok(!skill.includes('load_skill'));
});

test('child controls preserve exact identity and explicit follow-up',async()=>{
  const manifest = JSON.parse(await readFile(new URL('../plugin.json',import.meta.url),'utf8'));
  const tools = manifest.extensions['dev.sailry.platform'].tools;
  for(const name of ['spawn_agent','guide_agent','wait_agent']) {
    const description = tools.find(tool => tool.name === name).description;
    assert.match(description,/exact returned session ID/);
    assert.match(description,/never reconstruct/);
  }
  const guide = tools.find(tool => tool.name === 'guide_agent');
  assert.match(guide.description,/running child owned by this conversation/);
  assert.match(guide.description,/user requests follow-up work/);
  assert.match(guide.description,/spawn_agent with that session ID and a new task/);
  assert.match(guide.description,/entire current tool batch settles/);
});

test('catalog tools keep their own schemas and captured roster',()=>{
  let state;
  const functions = vm.runInNewContext(`${source}\n({initialize,prepare})`,{readTurnState:()=>state,stageTurnState:value=>state=value});
  const initialized = functions.initialize({tools:['spawn_agent','add_agent','apply_agents'],roles:[{key:'review',name:'Review',description:'Inspect'}],session_revision:'9007199254740993'});
  assert.deepEqual(Object.keys(initialized.parameters),['spawn_agent']);
  assert.deepEqual(plain(initialized.tools),['spawn_agent','add_agent','apply_agents']);
  assert.equal(state.session_revision,'9007199254740993');
  assert.match(initialized.instruction,/9007199254740993/);
  assert.equal(functions.prepare({role:'new-role',task:'Inspect'}).isError,true);
});
