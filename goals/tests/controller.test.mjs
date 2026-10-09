import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const plain=value=>JSON.parse(JSON.stringify(value));
function element(id) {
  return {id,items:[],children(items){this.items.push(...items);return this;},
    size(){return this;},label(){return this;},ghost(){return this;},
    disabled(value){this.disabledValue=value;return this;},on_click(action){this.action=action;return this;}};
}

async function fixture() {
  const host={goal:{id:'goal',description:'Requested work',state:'active',revision:'5'},
    hold:false,held:[],failure:null};
  const prepared=[],completed=[],forgotten=[],contributions=[],notices=[],jobs=[];
  const never=()=>new Promise(()=>{});
  const modules=new Map(),context=vm.createContext({});
  const sdk={
    nextChange:never,nextContributionEvent:never,
    publishContributions:value=>contributions.push(plain(value)),
    prepareRequest:request=>{prepared.push(plain(request));return String(prepared.length-1);},
    completeRequest:async id=>{
      completed.push(id);
      const request=prepared[Number(id)];
      if(request.data.handler==='read') {
        const result={Ok:{data:{goal:plain(host.goal)}}};
        return host.hold ? new Promise(resolve=>host.held.push(()=>resolve(result))) : result;
      }
      assert.equal(request.data.handler,'control');
      if(host.failure) return {Err:{code:host.failure,message:'Unconfirmed action'}};
      assert.equal(request.data.input.expected_revision,host.goal.revision);
      const revision=String(BigInt(host.goal.revision)+1n);
      host.goal=request.data.input.kind==='clear' ? null : {...host.goal,state:'paused',revision};
      return {Ok:{data:{goal:plain(host.goal)}}};
    },
    forgetRequest:id=>forgotten.push(id),faultCode:message=>message,
  };
  const exports={
    'gpui-kit':{View:class{}},
    'gpui-component':{Button:function(id){return element(id);}},
    sailry:{context:()=>JSON.stringify({locale:'en',package:{name:'goals'}})},
    'sailry/sdk':sdk,
    'sailry/ui':{StatusList:{new:element},
      readComposer:()=>({session:'session',connected:true,readonly:false,busy:false,mode:'code',cursor:'1'}),
      nextComposerChange:never,toast:value=>notices.push(plain(value))},
  };
  async function load(name) {
    if(modules.has(name)) return modules.get(name);
    const module=exports[name] ? new vm.SyntheticModule(Object.keys(exports[name]),function(){
      for(const [key,value] of Object.entries(exports[name])) this.setExport(key,value);
    },{context}) : new vm.SourceTextModule(await readFile(
      new URL(`../dev.sailry.platform/desktop/${name}`,import.meta.url),'utf8'),{context,identifier:name});
    modules.set(name,module);
    if(!exports[name]) await module.link(load);
    return module;
  }
  const main=await load('./main.js');await main.evaluate();
  const view=new main.namespace.default();
  const cx={notify(){},spawn(callback){const job=Promise.resolve().then(()=>callback(cx));jobs.push(job);return job;}};
  view.init(null,cx);await jobs[0];
  async function perform(kind) {
    const first=jobs.length;
    view.perform(kind,cx);
    if(jobs.length===first) return;
    await jobs[first];
    if(!host.hold) await jobs.at(-1);
  }
  return {view,host,cx,jobs,perform,prepared,completed,forgotten,contributions,notices};
}

test('held refresh blocks stale controls until current revision',async()=>{
  const setup=await fixture();
  assert.equal(setup.view.enabled(),true);
  setup.host.hold=true;
  await setup.perform('pause');
  assert.equal(setup.host.goal.revision,'6');
  assert.equal(setup.view.goal.revision,'5');
  assert.equal(setup.view.busy,false);
  assert.equal(setup.view.enabled(),false);
  assert.equal(setup.contributions.at(-1).find(item=>item.id==='goal').enabled,false);
  assert.ok(setup.view.render().items.every(item=>item.disabledValue===true));
  const count=setup.prepared.length;
  await setup.perform('clear');
  assert.equal(setup.prepared.length,count);
  assert.equal(setup.host.held.length,1);
  setup.host.hold=false;setup.host.held.shift()();await setup.jobs.at(-1);
  assert.equal(setup.view.goal.revision,'6');
  assert.equal(setup.view.enabled(),true);
  await setup.perform('clear');
  const controls=setup.prepared.filter(request=>request.data.handler==='control');
  assert.deepEqual(controls.map(request=>request.data.input),[
    {kind:'pause',expected_revision:'5'},{kind:'clear',expected_revision:'6'},
  ]);
  assert.equal(setup.host.goal,null);
  assert.equal(setup.view.goal,null);
  assert.equal(setup.view.pending,null);
});

test('dirty refresh remains blocked until latest read',async()=>{
  const setup=await fixture();
  setup.host.hold=true;
  setup.view.refresh(setup.cx);
  await Promise.resolve();
  assert.equal(setup.view.enabled(),false);
  setup.host.goal={...setup.host.goal,revision:'6',description:'Changed elsewhere'};
  setup.view.refresh(setup.cx);
  setup.host.hold=false;setup.host.held.shift()();await setup.jobs.at(-1);
  assert.equal(setup.view.goal.revision,'6');
  assert.equal(setup.view.goal.description,'Changed elsewhere');
  assert.equal(setup.view.enabled(),true);
  assert.equal(setup.prepared.filter(request=>request.data.handler==='read').length,3);
  assert.equal(setup.prepared.filter(request=>request.data.handler==='control').length,0);
});

test('uncertain control retains exact request for retry',async()=>{
  const setup=await fixture();
  setup.host.failure='outcome_unknown';
  await setup.perform('clear');
  const id=setup.view.pending.id;
  assert.equal(setup.view.enabled(),false);
  assert.equal(setup.host.goal.revision,'5');
  assert.ok(!setup.forgotten.includes(id));
  const count=setup.prepared.length;
  await setup.perform('pause');
  assert.equal(setup.prepared.length,count);
  setup.host.failure=null;
  const first=setup.jobs.length;
  setup.view.execute(setup.cx);await setup.jobs[first];await setup.jobs.at(-1);
  assert.equal(setup.prepared.filter(request=>request.data.handler==='control').length,1);
  assert.equal(setup.completed.filter(request=>request===id).length,2);
  assert.equal(setup.forgotten.filter(request=>request===id).length,1);
  assert.equal(setup.view.pending,null);
  assert.equal(setup.host.goal,null);
});
