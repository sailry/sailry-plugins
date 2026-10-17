import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";

async function fixture() {
  const records=(await readFile(new URL("../dev.sailry.platform/host/records.js",import.meta.url),"utf8"))
    .replace(/^import .*;\n/gm,"").replace(/^export /gm,"");
  const dispatch=(await readFile(new URL("../dev.sailry.platform/host/dispatch.js",import.meta.url),"utf8"))
    .replace(/^import .*;\n/gm,"").replace(/^export /gm,"");
  const mutations=(await readFile(new URL("../dev.sailry.platform/host/mutations.js",import.meta.url),"utf8"))
    .replace(/^import .*;\n/gm,"").replace(/^export /gm,"");
  const main=(await readFile(new URL("../dev.sailry.platform/host/management.js",import.meta.url),"utf8"))
    .replace(/^import .*;\n/gm,"").replace(/^export \{.*;\n/gm,"").replace(/^export /gm,"");
  const requests=[],transactions=[],values=new Map(),pages=new Map(),config={provider:"provider",model:"selected",effort:"high",mode:"code",permission:"ask"};
  const runtime={context:()=>({package:{name:"scheduled-tasks"},invocation:"00000000-0000-0000-0000-000000000001"}),
    getValue:async key=>values.get(key)??{revision:"0",present:false,value:null},listKeys:async()=>({keys:[],after:null}),
    readProjectCatalog:async()=>({projects:[],worktrees:[]}),
    prepareRequest:command=>{requests.push(command);return String(requests.length-1);},
    prepareTransaction:operations=>{transactions.push(operations);return "transaction";},
    completeRequest:async id=>{
      const command=requests[Number(id)];
      if(command?.kind==="resolve_plugin_model")return {Ok:{kind:"session_config",data:{...config}}};
      if(command?.data?.action.kind==="list_jobs") return {Ok:{data:{data:pages.get(command.data.action.data.before)??{jobs:[],next_before:null}}}};
      if(command?.data?.action.kind==="read_result") return {Ok:{data:{data:{kind:"completed",data:{Ok:{kind:"queued_turn",data:{session:`session-${command.data.action.data.id}`,id:"turn"}}}}}}};
      if(command?.kind==="dispatch")return {Ok:{data:{data:[]}}};
      return {Ok:{data:[{data:{revision:"1"}}]}};
    },forgetRequest(){},
  };
  const api=vm.runInNewContext(`${records}\n${dispatch}\n${mutations}\n${main}\n({draft,changes,list,save,run,states,history})`,runtime);
  const input={id:"00000000-0000-0000-0000-000000000002",revision:"0",name:"Review",prompt:"Read the project",
    queue:"default",enabled:false,project:null,worktree:null,config:null,timing:{kind:"once",data:{at_ms:Date.now()+300000}}};
  return {api,input,config,values,pages,requests,transactions};
}
test("current host entry points reject missing models before dispatch or storage mutation",async()=>{
  const setup=await fixture(),{api,input}=setup;
  assert.equal((await api.save(input)).Err.code,"not_configured");
  await assert.rejects(api.changes(input),error=>error.code==="not_configured");
  const entry={revision:"4",present:true,value:input};setup.values.set(`task/${input.id}`,entry);
  assert.equal((await api.run({id:input.id})).Err.code,"not_configured");
  assert.equal(setup.values.get(`task/${input.id}`),entry);
  assert.equal(setup.requests.length,0);assert.equal(setup.transactions.length,0);
});

test("management lists tasks without a queue settings lookup",async()=>{
  const setup=await fixture(),listed=await setup.api.list({});
  assert.deepEqual(JSON.parse(JSON.stringify(listed)),{Ok:{items:[],after:null}});
  assert.deepEqual(setup.requests.map(command=>command.data.action.kind),["list_schedules"]);
});
test("native states span job pages and prioritize active runs over later completions",async()=>{
  const setup=await fixture();
  setup.pages.set(null,{jobs:[
    {handler:"repeat",status:"completed",started_ms:3},{handler:"finished",status:"failed",started_ms:4},
    {handler:"queued",status:"completed"},{handler:"unstarted",status:"queued"},
  ],next_before:21});
  setup.pages.set(21,{jobs:[
    {handler:"repeat",status:"running",started_ms:2},{handler:"finished",status:"completed"},
    {handler:"queued",status:"queued"},
  ],next_before:10});
  setup.pages.set(10,{jobs:[{handler:"repeat",status:"queued"}],next_before:null});
  assert.deepEqual(JSON.parse(JSON.stringify(await setup.api.states())),
    {repeat:{status:"running",started_ms:2},finished:{status:"failed",started_ms:4},
      queued:{status:"queued",started_ms:null},unstarted:{status:"queued",started_ms:null}});
  assert.deepEqual(JSON.parse(JSON.stringify(setup.requests.map(command=>command.data.action.data))),
    [{before:null,limit:100},{before:21,limit:100},{before:10,limit:100}]);
  assert.equal(setup.transactions.length,0);
});
test("task history scans native pages for one handler's runs",async()=>{
  const setup=await fixture(),job=(id,handler)=>({id,handler,status:"completed",event:{payload:{name:"Review"}}});
  setup.pages.set(null,{jobs:[job("a1","a"),job("b1","b")],next_before:21});
  setup.pages.set(21,{jobs:[job("b2","b"),job("a2","a")],next_before:10});
  setup.pages.set(10,{jobs:[job("a3","a")],next_before:null});
  const page=JSON.parse(JSON.stringify(await setup.api.history({before:null,handler:"a",limit:2})));
  assert.deepEqual(page.Ok.items.map(item=>[item.job.id,item.session]),[["a1","session-a1"],["a2","session-a2"]]);
  assert.equal(page.Ok.next_before,10);
  const reads=setup.requests.map(command=>command.data.action).filter(action=>action.kind==="read_result").map(action=>action.data.id);
  assert.deepEqual(reads,["a1","a2"]);
  const rest=JSON.parse(JSON.stringify(await setup.api.history({before:10,handler:"a",limit:2})));
  assert.deepEqual(rest.Ok.items.map(item=>item.job.id),["a3"]);assert.equal(rest.Ok.next_before,null);
});
test("new handlers capture Node-validated configuration without exporting or choosing defaults",async()=>{
  const setup=await fixture(),requested={...setup.config,effort:"low"};setup.input.config=requested;
  const saved=await setup.api.save(setup.input);
  assert.deepEqual(JSON.parse(JSON.stringify(saved.Ok.config)),setup.config);
  const resolve=setup.requests.find(command=>command.kind==="resolve_plugin_model");
  assert.equal(resolve.data.model,"provider/selected");assert.equal(resolve.data.effort,"low");assert.equal(resolve.data.config,requested);
  const handler=setup.transactions[0].find(operation=>operation.kind==="dispatch"&&operation.data.kind==="save_handler");
  assert.deepEqual(JSON.parse(JSON.stringify(handler.data.data.callback.command.data.config)),setup.config);
  assert.equal(handler.data.data.callback.command.kind,"start_session");
  assert.equal(handler.data.data.callback.command.data.project,null);
});
