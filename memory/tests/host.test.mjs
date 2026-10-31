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
    ['retrieval.js',synthetic({indexMemories:sdk.indexMemories ?? unexpected('listMemories'),searchMemories:unexpected('searchMemories'),
      reviewMemories:async(settings,filter)=>review(await unexpected('listMemories')(),settings,filter,unexpected('readMemory'))})],
    ['storage.js',synthetic({readMemory:unexpected('readMemory'),snapshotChanged:()=>false,
      stable:read=>read(),head:async()=>({record:{revision:'1'}}),unchanged:async()=>{}})],
    ['recall.js',synthetic({recordRecalls:sdk.recordRecalls ?? (async()=>false)})],
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

test('places relevant bodies first and ranks remaining titles by use',async()=>{
  const {policy}=await load();
  const day=86_400_000;
  const entries=[{...summary,id:'old',title:'Old note',updated_at_ms:day},
    {...summary,id:'used',title:'Used note',updated_at_ms:0,recalled:4,last_recalled:3*day},
    {...summary,id:'new',title:'New note',updated_at_ms:2*day},
    {...summary,id:'tie',title:'Tie note',updated_at_ms:2*day,recalled:2},
    {...summary,id:'archived',title:'Archived note',archived:true,updated_at_ms:9*day}];
  const relevant=[{summary:{...summary,id:'used',title:'Used note'},body:'Use tabs'}];
  const {text,injected}=policy.instruction({relevant,entries,settings});
  assert.deepEqual(plain(injected.map(entry=>entry.summary.id)),['used']);
  const [policyLine,section,index]=text.trim().split('\n\n');
  assert.equal(policyLine,policy.policy(settings));
  assert.deepEqual(JSON.parse(section.split('\n')[1]),{id:'used',title:'Used note',kind:'feedback',global:false,revision:1,body:'Use tabs'});
  assert.equal(section.split('\n')[0],'Relevant memories:');
  assert.deepEqual(index.split('\n'),['Other memories (title and ID):','- Tie note (tie)','- New note (new)','- Old note (old)']);
});

test('fits five relevant bodies and the index in half the budget',async()=>{
  const {policy}=await load();
  const bounded={...settings,context_bytes:2048};
  const relevant=Array.from({length:8},(_,index)=>({summary:{...summary,id:`hit-${index}`},body:index===1 ? '中文🙂'.repeat(400) : `Fact ${index}`}));
  const entries=Array.from({length:60},(_,index)=>({...summary,id:`entry-${index}`,title:`Entry title ${index}`,updated_at_ms:index}));
  const {text,injected}=policy.instruction({relevant,entries,settings:bounded});
  assert.deepEqual(plain(injected.map(entry=>entry.summary.id)),['hit-0','hit-2','hit-3','hit-4','hit-5']);
  assert.ok(Buffer.byteLength(text)<=bounded.context_bytes/2);
  assert.ok(text.includes('- Entry title 59 (entry-59)'));
  assert.ok(!text.includes('hit-6'));
  assert.ok(!text.includes('Entry title 0 '));
  const none=policy.instruction({relevant:[],entries:[],settings});
  assert.equal(none.text,`\n\n${policy.policy(settings)}`);
  const titles=policy.instruction({relevant:[],entries:[summary],settings}).text;
  assert.match(titles,/\n\nMemories \(title and ID\):\n- Feedback \(/);
  assert.match(policy.instruction({settings,pending:true}).text,/Memory is changing; use search_memory/);
});

test('shares the exact serialized content budget with Unicode and escaped JSON',async () => {
  const {policy} = await load();
  const state = {remaining:1448};
  const entry = {summary,body:'中文🙂"\\\n'.repeat(200)};
  const results = policy.retrieve([entry],state);
  assert.equal(results.length,1);
  const body = JSON.parse(results[0].parts[0].text);
  assert.equal(body.body_truncated,true);
  assert.ok(entry.body.startsWith(body.body));
  assert.ok(Buffer.byteLength(JSON.stringify(results[0])) + 128 + 600 <= 2048);
  assert.equal(policy.retrieve([entry],state).length,0);
});

test('only complete currently visible search results authorize replacement',async () => {
  const {policy} = await load();
  const result = (name,truncated) => ({name,response:{entries:[{role:'user',parts:[{text:JSON.stringify({summary,body:'Keep conditions',body_truncated:truncated})}]}]}});
  for (const results of [[],[result('search_memory',true)],[result('review_memories',false)]]) {
    assert.throws(() => policy.requireRead({reads:policy.reads(results)},id,1),/complete current body/);
  }
  const state = {reads:policy.reads([result('search_memory',false)])};
  policy.requireRead(state,id,1);
  assert.throws(() => policy.requireRead(state,id,2));
  state.reads = policy.reads([]);
  assert.throws(() => policy.requireRead(state,id,1));
});

test('filters tools at initialization and never contributes imported package instructions',async () => {
  let state;
  let current = {...settings,auto_write:false};
  const {main} = await load({readMemorySettings:async()=>current,listMemories:async()=>[summary],stageTurnState:value=>state=plain(value),readTurnState:()=>plain(state)});
  const tools = ['search_memory','review_memories','save_memory','forget_memory','consolidate_memories'];
  let initialized = await main.initialize({tools,project,resources:true});
  assert.deepEqual(plain(initialized.tools),['search_memory','review_memories']);
  assert.match(initialized.instruction,/Memory is read-only this turn\./);
  assert.doesNotMatch(initialized.instruction,/Save with save_memory/);
  assert.ok(initialized.instruction.includes(`- Feedback (${id})`));
  assert.equal(state.remaining,settings.context_bytes-Buffer.byteLength(initialized.instruction));
  initialized = await main.initialize({tools:['search_memory'],project,resources:false});
  assert.equal(initialized.instruction,'');
  assert.equal(state.remaining,settings.context_bytes);
  current = {...current,enabled:false};
  initialized = await main.initialize({tools,project,resources:true});
  assert.deepEqual(plain(initialized),{instruction:'',tools:[]});
});

test('empty indexes preserve optional tool use',async()=>{
  let state;
  const calls=[];
  const {main}=await load({
    readMemorySettings:async()=>{calls.push('settings');return settings;},
    indexMemories:async()=>{calls.push('index');return [];},
    stageTurnState:value=>state=plain(value),readTurnState:()=>plain(state),
  });
  const tools=['search_memory','save_memory'];
  const initialized=await main.initialize({tools,project,resources:true});
  assert.deepEqual(plain(initialized.tools),tools);
  assert.equal(initialized.instruction,'\n\nMemory holds lasting user preferences, corrections and decisions. Use the relevant memories below when they apply; current instructions win. Save with save_memory when the user states a lasting preference, corrects you, confirms a decision, or asks you to remember something. Do not save secrets, task progress or facts available in code, Git or project docs.');
  await main.beforeModel({results:[]});
  assert.deepEqual(state.reads,[]);
  assert.deepEqual(calls,['settings','index']);
  assert.equal(state.remaining,settings.context_bytes-Buffer.byteLength(initialized.instruction));
});

test('injects relevant bodies and counts recalls once',async()=>{
  let state;
  const recorded=[], queries=[];
  const hit={summary,body:'Prefer tabs in Go files'};
  const other={summary:{...summary,id:'22222222-2222-4222-8222-000000000009',title:'Other'},body:'Run tests first'};
  const {main}=await load({readMemorySettings:async()=>settings,indexMemories:async()=>[summary,other.summary],
    searchMemories:async(scope,query)=>{queries.push([scope,query]);return query==='Format the Go files' ? [hit] : [other];},
    readMemory:async()=>structuredClone(hit),recordRecalls:async(summaries,known)=>{recorded.push(plain([summaries.map(value=>value.id),known ? [...known] : null]));return true;},
    stageTurnState:value=>state=plain(value),readTurnState:()=>plain(state),newId:()=>id});
  const initialized=await main.initialize({tools:['search_memory','save_memory'],project,resources:true,message:'Format the Go files',mode:'code'});
  assert.deepEqual(queries,[[project,'Format the Go files']]);
  assert.match(initialized.instruction,/Relevant memories:\n\{"id":"[^"]+","title":"Feedback","kind":"feedback","global":false,"revision":1,"body":"Prefer tabs in Go files"\}/);
  assert.match(initialized.instruction,/Other memories \(title and ID\):\n- Other \(/);
  assert.deepEqual(recorded,[[[id],[id,other.summary.id]]]);
  const denied=await main.save({arguments:{id,expected_revision:1,kind:'feedback',title:'Formatting',body:'Prefer tabs in Go files and Makefiles'},step:0});
  assert.equal(denied.result.error.code,'invalid_request','updates still require a search result');
  const searched=await main.search({query:'tests'});
  await main.beforeModel({results:[{name:'search_memory',response:searched}]});
  await main.beforeModel({results:[{name:'search_memory',response:searched}]});
  assert.deepEqual(recorded.slice(1),[[[other.summary.id],null]],'search hits count once per turn');
  await main.initialize({tools:['search_memory'],project,resources:true,message:'Format the Go files',mode:'plan'});
  assert.equal(recorded.length,2,'planning turns do not write statistics');
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


test('one short policy replaces repeated guidance',async () => {
  const manifest = JSON.parse(await readFile(new URL('../plugin.json',import.meta.url),'utf8'));
  const extension = manifest.extensions['dev.sailry.platform'];
  const {policy}=await load();
  assert.equal(extension.instructions,undefined);
  assert.ok(extension.actions.includes('conversation.message.read'));
  assert.equal(policy.policy(settings),'Memory holds lasting user preferences, corrections and decisions. Use the relevant memories below when they apply; current instructions win. Save with save_memory when the user states a lasting preference, corrects you, confirms a decision, or asks you to remember something. Do not save secrets, task progress or facts available in code, Git or project docs.');
  assert.equal(policy.policy({...settings,auto_write:false}),'Memory holds lasting user preferences, corrections and decisions. Use the relevant memories below when they apply; current instructions win. Memory is read-only this turn.');
  const initial=extension.tools.filter(tool=>tool.initial).map(tool=>tool.name);
  assert.deepEqual(initial,['search_memory','save_memory']);
  for (const tool of extension.tools) {
    assert.ok(tool.description.length<=400,tool.name);
    assert.doesNotMatch(tool.description,/receipt|Claim saved|Search first/);
  }
  const save=extension.tools.find(tool=>tool.name==='save_memory');
  assert.deepEqual(save.handler.parameters.required,['kind','title','body']);
  assert.match(save.description,/Omit id to create/);
});
