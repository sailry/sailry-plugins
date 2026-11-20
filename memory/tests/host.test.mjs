import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {review} from '../dev.sailry.platform/host/review.js';

async function load(sdk = {}) {
  const context = vm.createContext({});
  const cache = new Map();
  const names = ['readTurnState','stageTurnState','newId','isValueConflict'];
  const bridge = new vm.SyntheticModule(names,function() {
    for (const name of names) this.setExport(name, sdk[name] ?? (() => { throw new Error(`unexpected ${name}`); }));
  }, {context});
  const synthetic = values => new vm.SyntheticModule(Object.keys(values),function() {
    for (const [name,value] of Object.entries(values)) this.setExport(name,value);
  },{context});
  const unexpected = name => sdk[name] ?? (()=>{throw new Error(`unexpected ${name}`);});
  const services = new Map([
    ['settings.js',synthetic({readMemorySettings:unexpected('readMemorySettings')})],
    ['retrieval.js',synthetic({searchMemories:unexpected('searchMemories'),
      reviewMemories:async(settings,filter)=>review(await unexpected('listMemories')(),settings,filter,unexpected('readMemory'))})],
    ['storage.js',synthetic({readMemory:unexpected('readMemory'),snapshotChanged:()=>false,
      stable:read=>read(),head:async()=>({record:{revision:'1'}}),unchanged:async()=>{}})],
    ['mutations.js',synthetic({putOperations:(entry,expected_revision)=>({entry,expected_revision}),
      removeOperations:(id,expected_revision)=>({id,expected_revision}),mergeOperations:(entry,sources)=>({entry,sources}),
      memoryOutput:output=>({kind:'memory_results',data:output.data.map(value=>value.data.value.summary)}),RecordChanged:class extends Error{},EquivalentMemory:class extends Error{}})],
  ]);
  async function module(path) {
    if (path === 'sailry/sdk') return bridge;
    if (services.has(path)) return services.get(path);
    if (cache.has(path)) return cache.get(path);
    const source = await readFile(new URL(`../dev.sailry.platform/host/${path}`,import.meta.url),'utf8');
    const value = new vm.SourceTextModule(source,{context,identifier:path});
    cache.set(path,value);
    await value.link(name => module(name.replace('./','')));
    return value;
  }
  const main = await module('main.js');
  await main.evaluate();
  return {main:main.namespace,policy:cache.get('policy.js').namespace};
}
const id = '11111111-1111-4111-8111-111111111111';
const project = '22222222-2222-4222-8222-222222222222';
const settings = {enabled:true,auto_write:true,context_bytes:4096,review_after_days:90};
const summary = {id,project,title:'Feedback',kind:'feedback',revision:1,updated_at_ms:0,archived:false};
const plain = value => JSON.parse(JSON.stringify(value));

const hit = (index,body,changes={}) => ({summary:{...summary,id:`hit-${index}`,title:`Hit ${index}`,...changes},body});
const tag = 'Relevant memory: ';
const bodies = parts => plain(Array.from(parts).filter(part=>part.startsWith(tag)).map(part=>JSON.parse(part.slice(tag.length))));

test('turns one relevant body into one part',async()=>{
  const {policy}=await load();
  const parts=policy.turnParts({relevant:[{summary,body:'Use tabs'}],message:'Format Go files',settings,write:true});
  assert.equal(parts.length,1);
  assert.ok(parts[0].startsWith(tag));
  assert.deepEqual(bodies(parts),[{id,title:'Feedback',kind:'feedback',global:false,body:'Use tabs'}]);
  const global=policy.turnParts({relevant:[{summary:{...summary,project:null},body:'Use tabs'}],message:'Format',settings,write:true});
  assert.equal(bodies(global)[0].global,true);
  assert.deepEqual(plain(policy.turnParts({relevant:[],message:'Format Go files',settings,write:true})),[]);
});

test('keeps at most three bodies that fit half the budget',async()=>{
  const {policy}=await load();
  const bounded={...settings,context_bytes:2048};
  const relevant=[hit(0,'Fact 0'),hit(1,'中文🙂'.repeat(400)),hit(2,'Fact 2'),hit(3,'Fact 3'),hit(4,'Fact 4'),hit(5,'Fact 5')];
  const parts=policy.turnParts({relevant,message:'Format',settings:bounded,write:true});
  assert.deepEqual(bodies(parts).map(value=>value.id),['hit-0','hit-2','hit-3']);
  assert.ok(parts.reduce((size,part)=>size+Buffer.byteLength(part),0)<=bounded.context_bytes/2);
  assert.equal(policy.turnParts({relevant:relevant.slice(1,2),message:'Format',settings:bounded,write:true}).length,0);
  const big=hit(0,'a'.repeat(900)), size=Buffer.byteLength(policy.relevantParts([big],Infinity)[0]);
  assert.ok(size <= bounded.context_bytes/2 && size+Buffer.byteLength(policy.cue) > bounded.context_bytes/2);
  assert.deepEqual(bodies(policy.turnParts({relevant:[big],message:'Format',settings:bounded,write:true})).map(value=>value.id),['hit-0']);
  assert.deepEqual(plain(policy.turnParts({relevant:[big],message:'From now on, format Go files',settings:bounded,write:true})),[policy.cue],'the cue shares the half budget');
  assert.equal(policy.relevantLimit,3);
});

test('adds the save cue only for cue messages when writing is allowed',async()=>{
  const {policy}=await load();
  const cued=['Please remember my editor','I usually prefer a short test summary',
    'Our standing convention is to review migrations separately','From now on answer in Chinese',
    '请记住：离线部署是因为客户现场没有网络','以后都用中文回答','我习惯先看测试结果','我们的惯例是单独评审迁移'];
  for (const message of cued) {
    assert.deepEqual(plain(policy.turnParts({message,settings,write:true})),[policy.cue],message);
    assert.deepEqual(plain(policy.turnParts({message,settings,write:false})),[],message);
  }
  for (const message of ['Format the Go files','Use blue instead of green for this button',"Don't change the API",
    'Always close this stream in finally','Remember to run the tests','I prefer option B for this patch',
    'We decided to use this plan','Do not remember this value','这次改用列表，不要改接口','决定按这个方案做',
    '我喜欢这版按钮样式','记得跑测试','别再添加注释','不要记住这个值','',null,undefined]) {
    assert.deepEqual(plain(policy.turnParts({message,settings,write:true})),[],String(message));
  }
  assert.match(policy.cue,/explicit memory request or guidance for a separate future session/);
  const both=policy.turnParts({relevant:[{summary,body:'Use tabs'}],message:'For future sessions, use tabs',settings,write:true});
  assert.deepEqual([both.length,both.at(-1)],[2,policy.cue]);
});

test('filters tools at initialization and returns no instruction',async () => {
  let state;
  let current = {...settings,auto_write:false};
  const {main} = await load({readMemorySettings:async()=>current,stageTurnState:value=>state=plain(value),readTurnState:()=>plain(state)});
  const tools = ['search_memory','review_memories','save_memory','forget_memory','consolidate_memories'];
  let initialized = await main.initialize({tools,project,resources:true});
  assert.deepEqual(plain(initialized),{instruction:'',parts:[],tools:['search_memory','review_memories']});
  assert.equal(state.remaining,settings.context_bytes);
  initialized = await main.initialize({tools:['search_memory'],project,resources:false,message:'For future sessions, use tabs'});
  assert.deepEqual(plain(initialized),{instruction:'',parts:[],tools:['search_memory']});
  current = {...current,enabled:false};
  initialized = await main.initialize({tools,project,resources:true,message:'For future sessions, use tabs'});
  assert.deepEqual(plain(initialized),{instruction:'',parts:[],tools:[]});
});

test('turns without a hit or cue add no context or reads',async()=>{
  let state;
  const calls=[];
  const {main}=await load({
    readMemorySettings:async()=>{calls.push('settings');return settings;},
    searchMemories:async()=>{calls.push('search');return [];},
    stageTurnState:value=>state=plain(value),readTurnState:()=>plain(state),
  });
  const tools=['search_memory','save_memory'];
  for (const message of [null,undefined,'  ']) {
    const initialized=await main.initialize({tools,project,resources:true,message});
    assert.deepEqual(plain(initialized),{instruction:'',parts:[],tools});
  }
  assert.deepEqual(calls,['settings','settings','settings']);
  const searched=await main.initialize({tools,project,resources:true,message:'Format the Go files'});
  assert.deepEqual(plain(searched),{instruction:'',parts:[],tools});
  assert.deepEqual(calls.slice(3),['settings','search']);
  await main.beforeModel({results:[]});
  assert.deepEqual(state.reads,[]);
  assert.equal(state.remaining,settings.context_bytes);
});

test('injects matched bodies and the cue without counting recalls',async()=>{
  let state;
  const queries=[];
  const matched={summary,body:'Prefer tabs in Go files'};
  const message='For future sessions, format the Go files';
  const {main,policy}=await load({readMemorySettings:async()=>settings,
    searchMemories:async(scope,query,options)=>{queries.push([scope,query,options]);return query===message ? [matched] : [];},
    readMemory:async()=>structuredClone(matched),
    stageTurnState:value=>state=plain(value),readTurnState:()=>plain(state),newId:()=>id});
  const initialized=await main.initialize({tools:['search_memory','save_memory'],project,resources:true,message,mode:'code'});
  assert.deepEqual(plain(queries),[[project,message,{keyword:true}]]);
  assert.equal(initialized.instruction,'');
  assert.equal(initialized.parts.length,2);
  assert.deepEqual(bodies(initialized.parts),[{id,title:'Feedback',kind:'feedback',global:false,body:'Prefer tabs in Go files'}]);
  assert.equal(initialized.parts.at(-1),policy.cue);
  assert.equal(state.remaining,settings.context_bytes-initialized.parts.reduce((size,part)=>size+Buffer.byteLength(part),0));
  assert.deepEqual(state.reads,[],'injected bodies grant no read authority');
  const denied=await main.save({arguments:{id,expected_revision:1,kind:'feedback',title:'Formatting',body:'Prefer tabs in Go files and Makefiles'},step:0});
  assert.equal(denied.result.error.code,'invalid_request','updates still require a search result');
  const searched=await main.search({query:'tests'});
  await main.beforeModel({results:[{name:'search_memory',response:searched}]});
  assert.deepEqual(Object.keys(state).sort(),['mode','project','reads','remaining','settings']);
  const planning=await main.initialize({tools:['search_memory','save_memory'],project,resources:true,message,mode:'plan'});
  assert.deepEqual(bodies(planning.parts).map(value=>value.id),[id]);
  assert.ok(!planning.parts.includes(policy.cue),'planning turns reject writes');
});

test('search, replacement, scope policy and live revocation share one captured turn state',async () => {
  let state;
  let current = {...settings};
  const original = {summary,body:'Existing complete body'};
  const {main} = await load({readMemorySettings:async()=>current,listMemories:async()=>[summary],searchMemories:async()=>[original],readMemory:async()=>structuredClone(original),stageTurnState:value=>state=plain(value),readTurnState:()=>plain(state),newId:()=>id});
  await main.initialize({tools:['search_memory','save_memory'],project,resources:true});
  const input = {id,expected_revision:1,kind:'feedback',title:'Correction',body:'Updated with conditions'};
  const save=value=>main.save({arguments:value,step:0});
  assert.equal((await save(input)).result.error.code,'invalid_request');
  const retrieved = await main.search({query:id});
  main.beforeModel({results:[{name:'search_memory',response:retrieved}]});
  const prepared = await save(input);
  assert.equal(prepared.call.arguments.entry.summary.project,project);
  assert.equal(prepared.call.arguments.entry.body,input.body);
  main.beforeModel({results:[]});
  assert.equal((await save(input)).result.error.code,'invalid_request');
  const create = {expected_revision:0,global:true,kind:'project',title:'Invalid global fact',body:'A project fact'};
  assert.equal((await save(create)).result.error.code,'invalid_request');
  current.auto_write = false;
  assert.equal((await save({...create,kind:'user'})).result.error.code,'permission_denied');
});

test('uncaptured mutations preserve fields and authoritative faults',async () => {
  const {main} = await load();
  const output = {kind:'plugin_transaction',data:[{kind:'plugin_value',data:{value:{summary}}}]};
  assert.deepEqual(plain(main.result({output})),{updated:[summary]});
  const failure = {isError:true,error:{code:'outcome_unknown',message:'Uncertain'}};
  assert.equal(main.result({output:failure}),failure);
});

test('package review shares the captured content budget and never grants replacement authority',async () => {
  let state;
  const read = [];
  const entries = [{summary,body:'Use concise Chinese replies'},
    {summary:{...summary,id:'older',updated_at_ms:1},body:'Use concise Chinese replies today'},
    {summary:{...summary,id:'foreign',project:'elsewhere'},body:'Unavailable'}];
  const {main} = await load({readMemorySettings:async()=>settings,listMemories:async()=>entries.map(entry=>entry.summary),
    readMemory:async id=>{read.push(id);return entries.find(entry=>entry.summary.id===id);},
    stageTurnState:value=>state=plain(value),readTurnState:()=>plain(state)});
  await main.initialize({tools:['review_memories'],project,resources:false});
  const output = await main.review({});
  assert.equal(output.candidates.length,2);
  assert.ok(output.candidates.some(candidate=>candidate.duplicate_of==='older'));
  assert.ok(!read.includes('foreign'));
  assert.ok(state.remaining < settings.context_bytes);
  assert.ok(!JSON.stringify(output).includes('Use concise'));
  main.beforeModel({results:[{name:'review_memories',response:output}]});
  assert.deepEqual(state.reads,[]);
  state.remaining = 1;
  assert.deepEqual(plain(await main.review({})),{candidates:[]});
});


test('the fixed policy is the manifest instructions, not turn output',async () => {
  const manifest = JSON.parse(await readFile(new URL('../plugin.json',import.meta.url),'utf8'));
  const extension = manifest.extensions['dev.sailry.platform'];
  const {policy,main}=await load({readMemorySettings:async()=>settings,searchMemories:async()=>[{summary,body:'Use tabs'}],stageTurnState:()=>{}});
  assert.match(extension.instructions,/current instructions win/);
  assert.ok(Buffer.byteLength(extension.instructions)<=500);
  assert.equal(policy.policy,undefined);
  assert.equal(policy.instruction,undefined);
  const initialized=await main.initialize({tools:['search_memory','save_memory'],project,resources:true,message:'For future sessions, use tabs',mode:'code'});
  assert.equal(initialized.instruction,'');
  assert.ok(initialized.parts.every(part=>!part.includes(extension.instructions)));
  assert.ok(extension.actions.includes('conversation.message.read'));
  assert.deepEqual(extension.host.turn,{initialize:'initialize',before_model:'beforeModel'});
  const initial=extension.tools.filter(tool=>tool.initial).map(tool=>tool.name);
  assert.deepEqual(initial,['search_memory','save_memory']);
  for (const tool of extension.tools) {
    assert.ok(tool.description.length<=400,tool.name);
    assert.doesNotMatch(tool.description,/receipt|Claim saved|Search first/);
  }
  const save=extension.tools.find(tool=>tool.name==='save_memory');
  assert.deepEqual(save.handler.parameters.required,['kind','title','body']);
  assert.match(save.description,/Omit id to create/);
  for (const phrase of ['explicitly asks to remember','future sessions','one-off requests','Never save secrets',
    'project scope','cross-project user preferences or feedback','not duplicated','expected_revision from a complete current body']) {
    assert.ok(save.description.includes(phrase),phrase);
  }
});

test('recall counters and their storage are gone',async () => {
  const manifest = JSON.parse(await readFile(new URL('../plugin.json',import.meta.url),'utf8'));
  const extension = manifest.extensions['dev.sailry.platform'];
  assert.equal(extension.storage.collections.some(collection=>`${collection.key ?? collection.prefix}`.startsWith('memory/recall')),false);
  for (const resources of [extension.host.resources,extension.desktop.resources]) {
    assert.ok(resources.every(path=>!path.endsWith('recall.js')));
  }
  await assert.rejects(readFile(new URL('../dev.sailry.platform/host/recall.js',import.meta.url)),{code:'ENOENT'});
});
