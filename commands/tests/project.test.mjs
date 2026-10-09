import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {choices, selection} from '../dev.sailry.platform/desktop/access.js';
import {messages} from '../dev.sailry.platform/desktop/locales.js';

async function fixture() {
  const context=vm.createContext({}), prepared=[], completed=[], forgotten=[], states=[];
  const host={result:{Err:{code:'outcome_unknown'}}};
  const exports={
    'gpui-kit':{View:class {},div:()=>null},
    sailry:{context:()=>JSON.stringify({locale:'en'})},
    'sailry/sdk':{
      listTerminals:async()=>[],listTerminalTools:async()=>[],
      prepareTerminal:(tool,access)=>{const id=`request-${prepared.length}`;prepared.push({id,tool,access});return id;},
      completeRequest:async id=>{completed.push(id);return host.result;},
      forgetRequest:id=>forgotten.push(id),publishContributions:state=>states.push(state),
      nextContributionEvent(){},nextChange(){},
    },
    'sailry/ui':{openPane:()=>false,publishResourceTitles(){},toast(){},dismissToast(){},nextToastEvent(){}},
    './locales.js':{messages},'./labels.js':{title:()=>null,directory:()=>null},
    './access.js':{selection,choices},
  };
  const module=new vm.SourceTextModule(await readFile(new URL('../dev.sailry.platform/desktop/project.js',import.meta.url),'utf8'),{context});
  await module.link(name=>new vm.SyntheticModule(Object.keys(exports[name]),function(){
    for(const [key,value] of Object.entries(exports[name]))this.setExport(key,value);
  },{context}));
  await module.evaluate();
  const view=new module.namespace.default();
  view.init(null,{spawn(){}});
  Object.assign(view,{loading:false,ready:true,connected:true,tools:[{tool:'claude',available:true}]});
  const tasks=[],cx={notify(){},spawn(callback){tasks.push(Promise.resolve().then(()=>callback(cx)));}};
  let cursor=0;
  const settle=async()=>{while(cursor<tasks.length)await tasks[cursor++];};
  return {view,cx,settle,host,prepared,completed,forgotten,states};
}

test('controls preserve explicit workspace access across uncertain receipts',async()=>{
  const setup=await fixture();
  setup.view.publish();
  const workspace=setup.states.at(-1).find(state=>state.id==='terminal-cli').choices
    .find(choice=>choice.id==='claude:workspace');
  assert.match(workspace.label.label,/Workspace/);
  assert.equal(workspace.group.label,'Workspace');
  assert.equal(workspace.enabled,true);
  setup.view.start('claude:workspace',null,setup.cx);await setup.settle();
  assert.deepEqual(setup.prepared,[{id:'request-0',tool:'claude',access:'workspace'}]);
  assert.equal(setup.view.pending,'request-0');
  assert.equal(setup.view.error,'unknown');
  assert.deepEqual(setup.forgotten,[]);
  const choices=setup.states.at(-1).find(state=>state.id==='terminal-cli').choices;
  assert.equal(choices.find(choice=>choice.id==='shell:workspace').enabled,false);
  setup.host.result={Ok:{kind:'terminal',data:{id:'workspace'}}};
  setup.view.start(null,null,setup.cx);await setup.settle();
  assert.equal(setup.prepared.length,1);
  assert.deepEqual(setup.completed,['request-0','request-0']);
  assert.deepEqual(setup.forgotten,['request-0']);
  assert.equal(setup.view.pending,null);
});

test('ordinary project creation defaults to full access',async()=>{
  const setup=await fixture();setup.host.result={Ok:{kind:'terminal',data:{id:'full'}}};
  setup.view.start(null,null,setup.cx);await setup.settle();
  assert.deepEqual(setup.prepared,[{id:'request-0',tool:null,access:'unrestricted'}]);
});
