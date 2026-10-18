import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import * as draft from '../dev.sailry.platform/desktop/draft.js';
import {messages} from '../dev.sailry.platform/desktop/locales.js';

const source = (await readFile(new URL('../dev.sailry.platform/desktop/settings.js',import.meta.url),'utf8'))
  .replace(/^import[\s\S]*?from '[^']+';\n/gm,'').replace('export default class ','class ');
const capacitySource = (await readFile(new URL('../dev.sailry.platform/desktop/capacity.js',import.meta.url),'utf8'))
  .replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let finish; return {promise:new Promise(resolve => {finish = resolve;}),finish:value => finish(value)}; };
function events() {
  let resolve;
  return {next:() => new Promise(done => {resolve = done;}),send(value) {
    assert.ok(resolve); const done = resolve; resolve = null; done(value);
  }};
}
const model = {kind:'provider',id:'provider/model',provider:'Provider',model:'model',reasoning:true,
  default:true,efforts:['low','high'],default_effort:'high'};
const role = {id:'existing',revision:5,key:'review',name:'Review',appearance:null,description:'Kept',read_only:true,
  model:null,max_turns:null,skills:['retained'],instructions:'Original'};

async function settings(options = {}) {
  const changes = events(), controls = events(), menus = events(), closes = events(), inputs = events();
  const prepared = [], calls = [], forgotten = [], notices = [], released = [], fields = new Map();
  let profiles = [plain(role)], models = [plain(model)], ids = 0;
  let settings = {package:{name:'fixture',digest:'captured',settings_revision:'1'},values:{child_concurrency:'8',retained:'value'}};
  const bindings = {
    View:class {},context:() => '{"locale":"en"}',draft,messages,
    nextChange:changes.next,nextControlEvent:controls.next,nextMenuEvent:menus.next,
    modal_closed:closes.next,nextTextEvent:inputs.next,
    createText:value => {const id = `field-${++ids}`; fields.set(id,value); return id;},
    readText:id => fields.get(id),setText:(id,value) => fields.set(id,value),
    releaseText:id => {released.push(id); fields.delete(id);},
    toast:value => notices.push(value),dismissToast() {},forgetRequest:id => forgotten.push(id),
    listRoles:async () => plain(profiles),listModels:async () => ({models:plain(models)}),newRoleId:() => 'created',
    prepareRole:(role,revision) => {prepared.push(plain({kind:'edit',role,revision})); return `request-${prepared.length}`;},
    prepareRemoveRole:(id,revision) => {prepared.push({kind:'remove',id,revision}); return `request-${prepared.length}`;},
    completeRequest:async id => {calls.push(id); const value = prepared[Number(id.split('-')[1])-1];
      if(options.complete) return options.complete(id,value);
      if(value.kind === 'settings') {settings={...settings,package:{...settings.package,settings_revision:String(Number(settings.package.settings_revision)+1)},values:value.values};return {Ok:{kind:'plugin_settings',data:plain(settings)}};}
      return {Ok:{kind:value.kind === 'edit' ? 'role' : 'roles',data:{}}};},
    faultCode:message => message,
    readSettings:async () => plain(settings),
    prepareSettings:(values,edits,revision) => {prepared.push(plain({kind:'settings',values,edits,revision}));return `request-${prepared.length}`;}
  };
  bindings.Capacity = vm.runInNewContext(`${capacitySource}\nCapacity`,bindings);
  const Type = vm.runInNewContext(`${source}\nSettings`,bindings);
  const cx = {notify() {},spawn(action) {return action(cx);}};
  const view = new Type(); view.init({},cx); await tick();
  return {view,cx,changes,controls,menus,closes,inputs,prepared,calls,forgotten,notices,released,fields,
    async act(action) {action(); await tick(); await tick();},
    configuration(value) {settings=value;},
    catalog(roles,nextModels) {profiles = roles; if (nextModels) models = nextModels;},
    edit(field,value) {fields.set(view.dialog.fields[field],value);},
    choose(menu,value) {menus.send({menu,id:`${view.dialog.token}:${value}`});}
  };
}

test('capacity commits on blur and enter without losing other settings',async()=>{
  const f=await settings(),capacity=f.view.capacity;
  assert.equal(f.fields.get(capacity.field),'8');
  for(const [kind,value] of [['blur','1'],['enter','18446744073709551615']]) {
    const before=f.prepared.length;
    f.fields.set(capacity.field,value);
    await f.act(()=>f.inputs.send({id:capacity.field,kind:'change'}));
    assert.equal(f.prepared.length,before);
    await f.act(()=>f.inputs.send({id:capacity.field,kind}));
    assert.equal(f.prepared.length,before+1);
    assert.deepEqual(f.prepared.at(-1),{kind:'settings',values:{child_concurrency:value,retained:'value'},edits:{},revision:String(before+1)});
    assert.equal(capacity.request,null);
  }
  assert.equal(f.prepared.length,2);
  assert.equal(f.notices.filter(notice=>notice.kind==='success').length,2);
});

test('capacity rejects invalid integers before admission',async()=>{
  const f=await settings(),capacity=f.view.capacity;
  for(const value of ['0','-1','1.5','18446744073709551616','x','']) {
    f.fields.set(capacity.field,value);
    await f.act(()=>f.inputs.send({id:capacity.field,kind:'blur'}));
  }
  assert.deepEqual(f.prepared,[]);
  assert.equal(f.notices.length,6);
  assert.equal(f.fields.get(capacity.field),'');
});

test('capacity steps use exact integers and commit immediately',async()=>{
  const f=await settings(),capacity=f.view.capacity;
  await f.act(()=>f.inputs.send({id:capacity.field,kind:'increment'}));
  assert.equal(f.fields.get(capacity.field),'9');
  await f.act(()=>f.inputs.send({id:capacity.field,kind:'decrement'}));
  assert.equal(f.fields.get(capacity.field),'8');
  f.fields.set(capacity.field,'18446744073709551615');
  await f.act(()=>f.inputs.send({id:capacity.field,kind:'decrement'}));
  assert.equal(f.fields.get(capacity.field),'18446744073709551614');
  const before=f.prepared.length;
  f.fields.set(capacity.field,'18446744073709551615');
  await f.act(()=>f.inputs.send({id:capacity.field,kind:'increment'}));
  f.fields.set(capacity.field,'1');
  await f.act(()=>f.inputs.send({id:capacity.field,kind:'decrement'}));
  assert.equal(f.prepared.length,before);
});

test('capacity recovers an uncertain save through the original receipt',async()=>{
  let attempts=0;
  const f=await settings({complete:async(_,value)=>++attempts===1
    ? {Err:{code:'outcome_unknown'}}
    : {Ok:{kind:'plugin_settings',data:{package:{settings_revision:'2'},values:value.values}}}});
  const capacity=f.view.capacity;
  f.fields.set(capacity.field,'2');
  await f.act(()=>f.inputs.send({id:capacity.field,kind:'enter'}));
  assert.equal(capacity.locked(),true);
  assert.equal(capacity.request,'request-1');
  await f.act(()=>f.inputs.send({id:capacity.field,kind:'blur'}));
  assert.deepEqual(f.calls,['request-1','request-1']);
  assert.equal(f.prepared.length,1);
  assert.deepEqual(f.forgotten,['request-1']);
  assert.equal(capacity.locked(),false);
  assert.equal(f.fields.get(capacity.field),'2');
});

test('capacity conflicts retain drafts until another explicit commit',async()=>{
  const f=await settings({complete:async()=>({Err:{code:'revision_conflict'}})}),capacity=f.view.capacity;
  f.fields.set(capacity.field,'3');
  await f.act(()=>f.inputs.send({id:capacity.field,kind:'change'}));
  await f.act(()=>f.inputs.send({id:capacity.field,kind:'blur'}));
  assert.equal(f.fields.get(capacity.field),'3');
  assert.equal(capacity.request,null);
  assert.deepEqual(f.calls,['request-1']);
  assert.equal(f.notices.at(-1).message,messages('en').role_conflict);
});

test('saves the complete captured draft without changing hidden fields or model choices',async () => {
  const f = await settings(); f.view.edit(f.view.roles[0],f.cx);
  const owner = f.view.dialog;
  assert.equal(owner.readOnly,true);
  f.edit('key',' reviewer '); f.edit('name',' New name '); f.edit('turns','7');
  await f.act(() => f.choose('role-source','fixed'));
  f.catalog([{...role,revision:99}],[]);
  await f.act(() => f.changes.send({cursor:'1',connected:true}));
  await f.act(() => f.changes.send({cursor:'2',connected:true}));
  assert.equal(owner.models.length,1); assert.equal(owner.original.revision,5);
  await f.act(() => f.view.save(f.cx));
  assert.deepEqual(f.prepared,[{kind:'edit',revision:5,role:{...role,key:'reviewer',name:'New name',
    appearance:{icon:'ai',color:'none'},max_turns:7,model:{provider:'provider',model:'model',effort:'high'}}}]);
  assert.equal(f.view.dialog,null); assert.equal(f.released.length,4);
});

test('uncertain saves lock the draft and retry exactly the original receipt',async () => {
  let count = 0;
  const f = await settings({complete:async () => ++count === 1 ? {Err:{code:'outcome_unknown'}} : {Ok:{kind:'role',data:{}}}});
  f.view.edit(role,f.cx);
  await f.act(() => f.view.save(f.cx));
  const owner = f.view.dialog; assert.equal(owner.error,'role_unknown');
  await f.act(() => f.choose('role-source','fixed'));
  await f.act(() => f.controls.send({id:'role',value:{icon:'code',color:'red'}}));
  assert.equal(owner.model,null); assert.deepEqual(plain(owner.appearance),{icon:'ai',color:'none'});
  await f.act(() => f.view.save(f.cx));
  assert.deepEqual(f.calls,['request-1','request-1']); assert.equal(f.prepared.length,1);
  assert.deepEqual(f.forgotten,['request-1']); assert.equal(f.view.dialog,null);
});

test('revision conflicts preserve every edit and never automatically resubmit',async () => {
  const f = await settings({complete:async () => ({Err:{code:'revision_conflict'}})});
  f.view.edit(role,f.cx); f.edit('name','Retained draft'); f.edit('instructions','Changed instructions');
  await f.act(() => f.view.save(f.cx));
  assert.equal(f.view.dialog.error,'role_conflict'); assert.equal(f.view.dialog.request,null);
  assert.equal(f.fields.get(f.view.dialog.fields.name),'Retained draft');
  assert.equal(f.fields.get(f.view.dialog.fields.instructions),'Changed instructions');
  assert.equal(f.view.dialog.original.revision,5); assert.deepEqual(f.calls,['request-1']);
  assert.deepEqual(f.forgotten,['request-1']);
});

test('a closed admitted dialog cannot close or edit a newer dialog',async () => {
  const completion = deferred(), f = await settings({complete:() => completion.promise});
  f.view.edit(role,f.cx); const previous = f.view.dialog;
  await f.act(() => f.view.save(f.cx));
  f.view.close(f.cx); f.view.edit(null,f.cx); const current = f.view.dialog;
  await f.act(() => f.menus.send({menu:'role-source',id:`${previous.token}:fixed`}));
  await f.act(() => f.closes.send(previous.token));
  assert.equal(f.view.dialog,current); assert.equal(current.fixed,false);
  await f.act(() => completion.finish({Ok:{kind:'role',data:{}}}));
  assert.equal(f.view.dialog,current); assert.equal(current.closed,false);
});

test('presets replace only instructions and removal retries the captured role revision',async () => {
  let count = 0;
  const f = await settings({complete:async () => ++count === 1 ? {Err:{code:'unavailable'}} : {Ok:{kind:'roles',data:[]}}});
  f.view.edit(role,f.cx);
  await f.act(() => f.choose('role-presets','research'));
  assert.equal(f.fields.get(f.view.dialog.fields.instructions),messages('en').role_prompt_research);
  assert.equal(f.fields.get(f.view.dialog.fields.name),'Review');
  f.view.remove(role,f.cx);
  await f.act(() => f.view.save(f.cx));
  assert.equal(f.view.dialog.error,'role_unknown');
  await f.act(() => f.view.save(f.cx));
  assert.deepEqual(f.prepared,[{kind:'remove',id:'existing',revision:5}]);
  assert.deepEqual(f.calls,['request-1','request-1']); assert.equal(f.view.dialog,null);
});

test('research preset fills a new unsaved draft',async () => {
  const f = await settings();
  const existing = plain(f.view.roles);
  f.view.edit(null,f.cx);
  assert.equal(f.view.dialog.creating,true);
  await f.act(() => f.choose('role-presets','research'));
  const owner = f.view.dialog;
  assert.equal(f.prepared.length,0);
  assert.deepEqual(plain(f.view.roles),existing);
  assert.equal(f.fields.get(owner.fields.key),'research');
  assert.equal(f.fields.get(owner.fields.name),'Research');
  assert.equal(f.fields.get(owner.fields.turns),'8');
  assert.equal(owner.readOnly,true);
  assert.equal(owner.model,null);
  assert.deepEqual(plain(owner.original.skills),['web-search:research']);
  await f.act(() => f.view.save(f.cx));
  assert.equal(f.prepared.length,1);
  assert.equal(f.prepared[0].revision,0);
  assert.equal(f.prepared[0].role.key,'research');
  assert.equal(f.prepared[0].role.read_only,true);
  assert.deepEqual(plain(f.view.roles),existing);
});

test('duplicate research identifiers preserve the new draft',async () => {
  const f = await settings({complete:async () => ({Err:{code:'conflict'}})});
  const retained = {...role,key:'research',instructions:'User instructions',read_only:false};
  f.catalog([retained]);
  await f.act(() => f.changes.send({cursor:'1',connected:true}));
  await f.act(() => f.changes.send({cursor:'2',connected:true}));
  f.view.edit(null,f.cx);
  await f.act(() => f.choose('role-presets','research'));
  await f.act(() => f.view.save(f.cx));
  assert.equal(f.view.dialog.error,'role_duplicate');
  assert.equal(f.view.dialog.creating,true);
  assert.equal(f.prepared.length,1);
  assert.equal(f.prepared[0].role.id,'created');
  assert.equal(f.prepared[0].revision,0);
  assert.equal(f.fields.get(f.view.dialog.fields.key),'research');
  assert.deepEqual(plain(f.view.roles),[retained]);
});

test('disconnection blocks new actions while retaining an unsaved dialog',async () => {
  const f = await settings(); f.view.edit(role,f.cx); const owner = f.view.dialog;
  f.edit('name','Draft');
  await f.act(() => f.changes.send({cursor:'1',connected:false}));
  f.view.save(f.cx); f.view.remove(role,f.cx); f.view.edit(null,f.cx);
  assert.equal(f.view.dialog,owner); assert.equal(f.calls.length,0);
  assert.equal(f.fields.get(owner.fields.name),'Draft');
});
