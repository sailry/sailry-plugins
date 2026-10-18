import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const plain=value=>JSON.parse(JSON.stringify(value));
const value={id:'goal-id',description:'Finish the requested work',state:'active',after:null};

test('continuation markers remain localized package declarations',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../plugin.json',import.meta.url),'utf8'));
  const marker=manifest.extensions['dev.sailry.platform'].continuation_marker;
  assert.equal(marker.label,'Continue goal');assert.equal(marker.locales['zh-CN'],'继续执行目标');
  assert.equal(manifest.version,'0.1.2');assert.equal(manifest.extensions['dev.sailry.platform'].api_version,'v1');
});
async function fixture(entry={key:'goal',revision:'5',present:true,restored:true,value}) {
  let current=plain(entry),state;
  const requests=[];
  const scope={session:'session-id',turn:null};
  const session={revision:'3',config:{mode:'code'}};
  const history={page:{runs:[{turn:'last-turn',sequence:1,status:'completed',origin:null}],queue:{revision:'9007199254740993',paused:true,items:[]}},next_before:null};
  const sdk={context:()=>scope,newId:()=> 'new-goal',getConversationValue:async key=>{
    assert.equal(key,'goal');return plain(current);
  },setConversationValue:(key,value,revision)=>prepare([{kind:'conversation_write',data:{key,value,expected_revision:revision}}]),
  prepareTransaction:prepare,completeRequest:async id=>{
    const operations=requests[Number(id)];
    for (const operation of operations) {
      if (operation.kind==='conversation_write' || operation.kind==='conversation_remove') {
        assert.equal(operation.data.key,'goal');
        assert.equal(operation.data.expected_revision,current.revision);
        current={...current,revision:String(BigInt(current.revision)+1n),restored:false,
          present:operation.kind==='conversation_write',value:operation.data.value ?? null};
      }
    }
    return {Ok:{data:operations.length===1 ? plain(current) : operations.map(()=>({data:{}}))}};
  },forgetRequest:()=>{},readSession:async()=>plain(session),
  readConversation:async()=>plain(history),readTurn:async()=>({run:plain(history.page.runs[0])}),
  readTurnState:()=>state,stageTurnState:value=>state=plain(value)};
  function prepare(operations) {requests.push(plain(operations));return String(requests.length-1);}
  const context=vm.createContext({});
  const bridge=new vm.SyntheticModule(Object.keys(sdk),function(){
    for (const [name,value] of Object.entries(sdk)) this.setExport(name,value);
  },{context});
  const modules=new Map([['sailry/sdk',bridge]]);
  async function load(path) {
    if (modules.has(path)) return modules.get(path);
    const source=await readFile(new URL(`../dev.sailry.platform/host/${path}`,import.meta.url),'utf8');
    const module=new vm.SourceTextModule(source,{context,identifier:path});
    modules.set(path,module);await module.link(load);return module;
  }
  const main=await load('./main.js');await main.evaluate();
  return {api:main.namespace,requests,history,scope,session,state:()=>state,current:()=>plain(current)};
}

test('restored active goals remain suspended without a write or continuation',async()=>{
  const {api,requests,state}=await fixture();
  assert.equal((await api.read()).goal.state,'paused');
  const initialized=await api.initialize({mode:'code',tools:['get_goal','create_goal','update_goal']});
  assert.equal(initialized.instruction,'');
  assert.equal(state().executingGoal,false);
  assert.deepEqual(plain(await api.completed({turn:'last-turn'})),{});
  assert.equal(requests.length,0);
  await assert.rejects(api.update({goal_id:value.id,expected_revision:'5',description:value.description,state:'completed'}),/No active goal/);
});

test('restoration preserves terminal state and exact live revision',async()=>{
  for (const state of ['paused','blocked','failed','completed']) {
    const {api}=await fixture({key:'goal',revision:'9007199254740993',present:true,restored:true,value:{...value,state}});
    const result=await api.read();
    assert.equal(result.goal.id,value.id);
    assert.equal(result.goal.description,value.description);
    assert.equal(result.goal.state,state);
    assert.equal(result.goal.revision,'9007199254740993');
  }
});

test('only explicit resume writes a live state and submits work',async()=>{
  const {api,requests,current}=await fixture();
  const result=await api.control({kind:'resume',goal_id:value.id,expected_revision:'5'});
  assert.equal(result.goal.state,'active');
  assert.equal(current().restored,false);
  assert.equal(requests.length,1);
  assert.deepEqual(requests[0].map(operation=>operation.kind),['queue_pause','conversation_write','continue']);
  assert.deepEqual(requests[0][0].data,{session:'session-id',expected_revision:'9007199254740993',paused:false});
  assert.equal(requests[0][1].data.key,'goal');
  assert.equal(requests[0][1].data.value.after,'last-turn');
  assert.equal(requests[0][2].data.session,'session-id');
  assert.equal(requests[0][2].data.expected_revision,'6');
  await api.completed({turn:'last-turn'});
  assert.equal(requests[1][0].kind,'continue');
  assert.equal(requests[1][0].data.scope,'conversation');
  assert.equal(requests[1][0].data.expected_revision,'6');
  assert.equal(requests[1].length,1);
});

test('guidance keeps a goal active and the next completed turn continues',async()=>{
  const {api,requests,current,history}=await fixture({key:'goal',revision:'5',present:true,restored:false,value});
  history.page.runs[0].status='continued';
  await api.completed({turn:'last-turn'});
  assert.equal(current().value.state,'active');assert.equal(requests.length,0);
  history.page.runs[0]={turn:'guided-turn',sequence:2,status:'completed',origin:null};
  await api.completed({turn:'guided-turn'});
  assert.equal(requests[0][0].kind,'continue');assert.equal(requests[0][0].data.after,'guided-turn');
});

test('explicit interruption still pauses an active goal',async()=>{
  const {api,history}=await fixture({key:'goal',revision:'5',present:true,restored:false,value});
  history.page.runs[0].status='interrupted';
  await api.completed({turn:'last-turn'});assert.equal((await api.read()).goal.state,'paused');
});

test('clear records absence in the captured conversation',async()=>{
  const {api,requests,current}=await fixture();
  assert.equal((await api.control({kind:'clear',goal_id:value.id,expected_revision:'5'})).goal,null);
  assert.deepEqual(requests[0],[{kind:'conversation_remove',data:{key:'goal',expected_revision:'5'}}]);
  assert.equal(current().present,false);
  assert.equal(current().revision,'6');
});

test('control tools require the inspected identity and exact revision',async()=>{
  for (const kind of ['pause','resume','clear']) {
    const {api,requests}=await fixture();
    for (const args of [
      {goal_id:'another-goal',expected_revision:'5'},
      {goal_id:value.id,expected_revision:'4'},
      {goal_id:value.id,expected_revision:5},
      {goal_id:value.id,expected_revision:'05'},
    ]) await assert.rejects(api[kind](args),/Goal changed/);
    await assert.rejects(api[kind]({goal_id:value.id}),/Invalid goal arguments/);
    await assert.rejects(api[kind]({goal_id:value.id,expected_revision:'5',kind}),/Invalid goal arguments/);
    assert.equal(requests.length,0);
  }
  const {api,requests}=await fixture();
  await assert.rejects(api.control({kind:'unknown',goal_id:value.id,expected_revision:'5'}),/Invalid goal action/);
  assert.equal(requests.length,0);
});

test('agent resume uses its current turn without admitting another',async()=>{
  const {api,scope,requests,state,current,session}=await fixture();
  scope.turn='current-turn';
  await api.initialize({mode:'code',tools:['get_goal','resume_goal']});
  assert.equal(state().executingGoal,false);
  assert.equal((await api.resume({goal_id:value.id,expected_revision:'5'})).goal.state,'active');
  assert.deepEqual(requests[0].map(operation=>operation.kind),['queue_pause','conversation_write']);
  assert.equal(current().value.after,'last-turn');
  assert.equal(state().executingGoal,true);
  const plan=await fixture();plan.scope.turn='current-turn';plan.session.config.mode='plan';
  await assert.rejects(plan.api.resume({goal_id:value.id,expected_revision:'5'}),/Code mode/);
  assert.equal(plan.requests.length,0);
  const selected=await api.initialize({mode:'plan',tools:['get_goal','create_goal','update_goal','resume_goal','pause_goal','clear_goal']});
  assert.deepEqual(plain(selected.tools),['get_goal']);
  assert.equal(state().executingGoal,false);
  assert.equal(session.config.mode,'code');
});

test('agent pause and clear preserve canonical result before stopping',async()=>{
  for (const kind of ['pause','clear']) {
    const {api,scope,history,requests}=await fixture({key:'goal',revision:'5',present:true,restored:false,value});
    scope.turn='current-turn';
    history.page.runs.push({turn:scope.turn,sequence:2,status:'running',origin:null});
    await api.initialize({mode:'code',tools:[`${kind}_goal`]});
    const result=await api[kind]({goal_id:value.id,expected_revision:'5'});
    assert.equal(result.goal?.state ?? null,kind==='pause'?'paused':null);
    assert.equal(requests[0].length,1);
    assert.equal(requests[0][0].kind,kind==='pause'?'conversation_write':'conversation_remove');
    assert.equal((await api.observe()).stop,true);
  }
});

test('long descriptions retain their complete contents',async()=>{
  const {api,current}=await fixture({key:'goal',revision:'0',present:false,restored:false,value:null});
  const description='Long goal '.repeat(1000).trim();
  await api.create({description});
  assert.equal(current().value.description,description);
});
