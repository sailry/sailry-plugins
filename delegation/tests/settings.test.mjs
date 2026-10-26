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
  const changes = events(), controls = events(), menus = events(), closes = events(), inputs = events(), sliders = events();
  const prepared = [], calls = [], forgotten = [], notices = [], released = [], scopes = [], fields = new Map();
  let profiles = [plain(role)], models = [plain(model)], ids = 0;
  let settings = {package:{name:'fixture',digest:'captured',settings_revision:'1'},values:{child_concurrency:options.value ?? '8',retained:'value'}};
  const bindings = {
    View:class {},context:() => '{"locale":"en"}',draft,messages,
    nextChange:(cursor,scope)=>{scopes.push(scope);return changes.next(cursor);},nextControlEvent:controls.next,nextMenuEvent:menus.next,
    modal_closed:closes.next,nextTextEvent:inputs.next,nextSliderEvent:sliders.next,
    createSlider:value => {const id=`slider-${++ids}`;fields.set(id,value);return id;},
    setSlider:(id,value)=>fields.set(id,value),
    createText:value => {const id = `field-${++ids}`; fields.set(id,value); return id;},
    readText:id => fields.get(id),setText:(id,value) => fields.set(id,value),
    releaseText:id => {released.push(id); fields.delete(id);},
    toast:value => notices.push(value),dismissToast() {},forgetRequest:id => forgotten.push(id),
    listRoles:async () => {if(options.read) await options.read();return plain(profiles);},listModels:async () => ({models:plain(models)}),newRoleId:() => 'created',
    prepareRole:(role,revision) => {prepared.push(plain({kind:'edit',role,revision})); return `request-${prepared.length}`;},
    prepareRemoveRole:(id,revision) => {prepared.push({kind:'remove',id,revision}); return `request-${prepared.length}`;},
    completeRequest:async id => {calls.push(id); const value = prepared[Number(id.split('-')[1])-1];
      if(options.complete) return options.complete(id,value);
      if(value.kind === 'settings') {settings={...settings,package:{...settings.package,settings_revision:String(Number(settings.package.settings_revision)+1)},values:value.values};return {Ok:{kind:'plugin_settings',data:plain(settings)}};}
      return {Ok:{kind:value.kind === 'edit' ? 'role' : 'roles',data:{}}};},
    faultCode:message => message,
    readSettings:async () => {if(options.readSettings)await options.readSettings();return plain(settings);},
    prepareSettings:(values,edits,revision) => {if(options.prepare)options.prepare();prepared.push(plain({kind:'settings',values,edits,revision}));return `request-${prepared.length}`;}
  };
  bindings.Capacity = vm.runInNewContext(`${capacitySource}\nCapacity`,bindings);
  const Type = vm.runInNewContext(`${source}\nSettings`,bindings);
  const cx = {notify() {},sleep:options.sleep ?? (async () => {}),spawn(action) {return action(cx);}};
  const view = new Type(); view.init({},cx); await tick();
  return {view,cx,changes,controls,menus,closes,inputs,sliders,prepared,calls,forgotten,notices,released,scopes,fields,
    async act(action) {action(); await tick(); await tick();},
    configuration(value) {settings=value;},
    catalog(roles,nextModels) {profiles = roles; if (nextModels) models = nextModels;},
    edit(field,value) {fields.set(view.dialog.fields[field],value);},
    choose(menu,value) {menus.send({menu,id:`${view.dialog.token}:${value}`});}
  };
}

test('capacity saves once on release and preserves other settings',async()=>{
  const f=await settings(),capacity=f.view.capacity;
  assert.equal(capacity.value,'8');
  assert.equal(f.view.ready,true);
  for(const value of [12,16,24]) await f.act(()=>f.sliders.send({id:capacity.field,kind:'change',value}));
  assert.equal(capacity.value,'24');
  assert.equal(f.prepared.length,0);
  await f.act(()=>f.sliders.send({id:capacity.field,kind:'release',value:24}));
  assert.deepEqual(f.prepared,[{kind:'settings',values:{child_concurrency:'24',retained:'value'},edits:{},revision:'1'}]);
  assert.equal(capacity.request,null);
  assert.equal(f.notices.filter(notice=>notice.kind==='success').length,1);
});

test('hidden catalogs catch up once and retain drafts on background failures',async()=>{
  let reads=0,failed=false;
  const f=await settings({read(){reads++;if(failed)throw Error('unavailable');},
    readSettings(){if(failed)throw Error('unavailable');}});
  f.view.edit(role,f.cx);f.edit('name','Retained draft');
  const original=f.view.roles,saved=f.view.capacity.saved;
  await f.act(()=>f.changes.send({cursor:'1',connected:true,visible:false}));
  for(let count=2;count<12;count++)await f.act(()=>f.changes.send({cursor:String(count),connected:true,visible:false}));
  assert.equal(reads,1);assert.equal(f.view.roles,original);
  failed=true;
  await f.act(()=>f.changes.send({cursor:'shown',connected:true,visible:true}));
  assert.equal(reads,2);assert.equal(f.view.roles,original);assert.equal(f.view.capacity.saved,saved);
  assert.equal(f.fields.get(f.view.dialog.fields.name),'Retained draft');
  assert.deepEqual(f.notices,[]);assert.equal(f.scopes.every(scope=>scope==='package'),true);
  await f.act(()=>f.view.load(f.cx,true));
  assert.equal(f.notices.filter(value=>value.kind==='error').length,2);
});

test('catalog bursts retain one follow-up and publish the latest data',async()=>{
  const gate=deferred();let held=false,reads=0;
  const f=await settings({async read(){reads++;if(held)await gate.promise;}});
  await f.act(()=>f.changes.send({cursor:'1',connected:true}));
  const original=f.view.roles;held=true;f.view.load(f.cx);
  for(let count=2;count<12;count++)await f.act(()=>f.changes.send({cursor:String(count),connected:true}));
  assert.equal(reads,2);assert.equal(f.view.roles,original);
  f.catalog([{...role,name:'Latest role'}]);held=false;
  await f.act(()=>gate.finish());
  assert.equal(reads,3);assert.equal(f.view.roles[0].name,'Latest role');
  assert.equal(f.view.loading,false);assert.deepEqual(f.notices,[]);
});

test('capacity keeps existing values outside the slider range',async()=>{
  for(const value of ['1','51','18446744073709551615']) {
    const f=await settings({value});
    assert.equal(f.view.capacity.value,value);
    assert.equal(f.fields.get(f.view.capacity.field),Number(BigInt(value)>50n ? 50n : BigInt(value)));
    assert.deepEqual(f.prepared,[]);
    await f.act(()=>f.changes.send({cursor:'1',connected:true}));
    await f.act(()=>f.changes.send({cursor:'2',connected:true}));
    assert.equal(f.view.capacity.value,value);
    assert.deepEqual(f.prepared,[]);
  }
});

test('capacity rejects invalid user events before admission',async()=>{
  const f=await settings(),capacity=f.view.capacity;
  for(const value of [0,51,1.5,NaN,Infinity]) await f.act(()=>f.sliders.send({id:capacity.field,kind:'release',value}));
  assert.equal(capacity.value,'8');
  assert.deepEqual(f.prepared,[]);
});

test('capacity recovers uncertain saves through the original receipt',async()=>{
  let attempts=0;
  const f=await settings({complete:async(_,value)=>++attempts===1
    ? {Err:{code:'outcome_unknown'}}
    : {Ok:{kind:'plugin_settings',data:{package:{settings_revision:'2'},values:value.values}}}});
  const capacity=f.view.capacity;
  await f.act(()=>f.sliders.send({id:capacity.field,kind:'release',value:2}));
  assert.equal(capacity.locked(),true);
  assert.equal(capacity.request,'request-1');
  await f.act(()=>capacity.save(f.cx));
  assert.deepEqual(f.calls,['request-1','request-1']);
  assert.equal(f.prepared.length,1);
  assert.deepEqual(f.forgotten,['request-1']);
  assert.equal(capacity.locked(),false);
  assert.equal(capacity.value,'2');
});

test('capacity preparation failures retain drafts without uncertain outcomes',async()=>{
  const f=await settings({prepare(){throw new Error('unavailable');}}),capacity=f.view.capacity;
  await f.act(()=>f.sliders.send({id:capacity.field,kind:'release',value:3}));
  assert.equal(capacity.value,'3');
  assert.equal(capacity.request,null);
  assert.deepEqual(f.calls,[]);
  assert.equal(f.notices.at(-1).message,messages('en').role_failed);
});

test('capacity conflicts retain drafts until another explicit commit',async()=>{
  const f=await settings({complete:async()=>({Err:{code:'revision_conflict'}})}),capacity=f.view.capacity;
  await f.act(()=>f.sliders.send({id:capacity.field,kind:'release',value:3}));
  assert.equal(capacity.value,'3');
  assert.equal(capacity.request,null);
  assert.deepEqual(f.calls,['request-1']);
  assert.equal(f.notices.at(-1).message,messages('en').role_conflict);
});

test('pending settings coalesce refreshes without replacing content',async()=>{
  const pending=deferred();let reads=0;
  const f=await settings({read(){reads++;},complete:()=>pending.promise}),capacity=f.view.capacity;
  await f.act(()=>f.changes.send({cursor:'1',connected:true}));
  await f.act(()=>f.sliders.send({id:capacity.field,kind:'release',value:2}));
  const original=f.view.roles;
  for(const cursor of ['2','3']) await f.act(()=>f.changes.send({cursor,connected:true}));
  assert.equal(reads,1);
  assert.equal(f.view.roles,original);
  assert.equal(f.view.ready,true);
  assert.equal(capacity.value,'2');
  const saved={package:{settings_revision:'2'},values:{child_concurrency:'2',retained:'value'}};
  f.configuration(saved);
  pending.finish({Ok:{kind:'plugin_settings',data:saved}});
  await tick();await tick();
  assert.equal(reads,2);
  assert.equal(capacity.value,'2');
  assert.equal(f.view.ready,true);
});

test('capacity serializes only the latest released draft',async()=>{
  const first=deferred(),second=deferred();
  const f=await settings({complete:id=>id==='request-1' ? first.promise : second.promise});
  const capacity=f.view.capacity;
  await f.act(()=>f.sliders.send({id:capacity.field,kind:'release',value:2}));
  assert.equal(capacity.locked(),false);
  for(const value of [4,6]) await f.act(()=>f.sliders.send({id:capacity.field,kind:'release',value}));
  assert.equal(capacity.value,'6');
  assert.deepEqual(f.calls,['request-1']);
  const saved={package:{settings_revision:'2'},values:{child_concurrency:'2',retained:'value'}};
  await f.act(()=>first.finish({Ok:{kind:'plugin_settings',data:saved}}));
  assert.equal(capacity.value,'6');
  assert.deepEqual(f.prepared.map(value=>[value.revision,value.values.child_concurrency]),[['1','2'],['2','6']]);
  assert.deepEqual(f.calls,['request-1','request-2']);
  assert.equal(f.notices.filter(value=>value.kind==='success').length,0);
  const latest={package:{settings_revision:'3'},values:{child_concurrency:'6',retained:'value'}};
  f.configuration(latest);
  await f.act(()=>second.finish({Ok:{kind:'plugin_settings',data:latest}}));
  assert.equal(capacity.value,'6');
  assert.equal(capacity.dirty,false);
  assert.equal(capacity.request,null);
  assert.deepEqual(f.forgotten,['request-1','request-2']);
  assert.equal(f.notices.filter(value=>value.kind==='success').length,1);
  assert.equal(f.prepared.every(value=>value.values.retained==='value'),true);
});

test('coalesced external changes preserve an unreleased local draft',async()=>{
  const pending=deferred();let reads=0;
  const f=await settings({read(){reads++;},complete:()=>pending.promise}),capacity=f.view.capacity;
  await f.act(()=>f.changes.send({cursor:'1',connected:true}));
  await f.act(()=>f.sliders.send({id:capacity.field,kind:'release',value:2}));
  f.catalog([{...role,name:'External role'}],[{...model,model:'external-model'}]);
  for(const cursor of ['2','3']) await f.act(()=>f.changes.send({cursor,connected:true}));
  await f.act(()=>f.sliders.send({id:capacity.field,kind:'change',value:3}));
  assert.equal(f.view.ready,true);
  assert.equal(reads,1);
  const saved={package:{settings_revision:'2'},values:{child_concurrency:'2',retained:'external'}};
  f.configuration(saved);
  await f.act(()=>pending.finish({Ok:{kind:'plugin_settings',data:saved}}));
  assert.equal(reads,2);
  assert.equal(f.view.ready,true);
  assert.equal(f.view.roles[0].name,'External role');
  assert.equal(f.view.models[0].model,'external-model');
  assert.equal(capacity.saved.values.retained,'external');
  assert.equal(capacity.value,'3');
  assert.equal(capacity.dirty,true);
  assert.equal(capacity.request,null);
  assert.equal(capacity.unknown,false);
  assert.deepEqual(f.calls,['request-1']);
  assert.equal(f.notices.filter(value=>value.kind==='success').length,0);
});

test('failed follow-up preparation releases deferred catalog refreshes',async()=>{
  const pending=deferred();let preparations=0,reads=0;
  const f=await settings({read(){reads++;},prepare(){if(++preparations===2)throw new Error('revision_conflict');},
    complete:()=>pending.promise}),capacity=f.view.capacity;
  await f.act(()=>f.changes.send({cursor:'1',connected:true}));
  await f.act(()=>f.sliders.send({id:capacity.field,kind:'release',value:2}));
  await f.act(()=>f.sliders.send({id:capacity.field,kind:'release',value:4}));
  await f.act(()=>f.changes.send({cursor:'2',connected:true}));
  const saved={package:{settings_revision:'2'},values:{child_concurrency:'2',retained:'value'}};
  f.configuration(saved);
  await f.act(()=>pending.finish({Ok:{kind:'plugin_settings',data:saved}}));
  assert.equal(reads,2);
  assert.equal(capacity.value,'4');
  assert.equal(capacity.dirty,true);
  assert.equal(capacity.request,null);
  assert.equal(capacity.pending,false);
  assert.equal(capacity.unknown,false);
  assert.deepEqual(f.calls,['request-1']);
  assert.equal(f.notices.at(-1).message,messages('en').role_conflict);
  assert.equal(f.notices.filter(value=>value.kind==='success').length,0);
});

test('uncertain receipts pause queued releases until original recovery',async()=>{
  const pending=deferred();let attempts=0;
  const f=await settings({complete:async(_,value)=>++attempts===1 ? pending.promise
    : {Ok:{kind:'plugin_settings',data:{package:{settings_revision:String(attempts)},values:value.values}}}});
  const capacity=f.view.capacity;
  await f.act(()=>f.sliders.send({id:capacity.field,kind:'release',value:2}));
  await f.act(()=>f.sliders.send({id:capacity.field,kind:'release',value:4}));
  await f.act(()=>pending.finish({Err:{code:'outcome_unknown'}}));
  assert.equal(capacity.unknown,true);
  assert.equal(capacity.locked(),true);
  assert.equal(capacity.value,'4');
  assert.deepEqual(f.calls,['request-1']);
  assert.equal(f.prepared.length,1);
  await f.act(()=>capacity.save(f.cx));
  assert.deepEqual(f.calls,['request-1','request-1','request-2']);
  assert.deepEqual(f.prepared.map(value=>value.values.child_concurrency),['2','4']);
  assert.equal(capacity.value,'4');
  assert.equal(capacity.unknown,false);
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
