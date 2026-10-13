import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {State,query,choices,nodeId} from '../dev.sailry.platform/desktop/state.js';
import {metrics} from '../dev.sailry.platform/desktop/metrics.js';
import {formatRows} from '../dev.sailry.platform/desktop/requests.js';
import {messages} from '../dev.sailry.platform/desktop/locales.js';
const text=messages('en');
test('speed details use latest own first text latency',()=>{
  for (const locale of ['en','zh-CN','de','es','fr','ja','ko','pt-BR','ru','zh-TW']) {
    const text=messages(locale);
    for (const [first,value] of [[null,'0'],['0','0.0 ms'],['125000','125.0 ms'],['2000000','2.00 s']]) {
      const statistics={first_token_us:first,generation:{output_tokens:'20',elapsed_us:'1000000',responses:'1'},
        delegated:{first_token_us:'1',generation:{output_tokens:'10000',elapsed_us:'1',responses:'2'}}};
      const before=structuredClone(statistics),speed=metrics({has_messages:true,statistics},text).find(value=>value.id==='composer_speed');
      assert.equal(speed.value,'20.0/s');
      assert.deepEqual(speed.details[2],{label:{label:text.composer_first_token},value});
      assert.deepEqual(statistics,before);
      assert.ok(text.composer_first_token);
    }
  }
});
test('normalizes public endpoint bytes into an opaque stable selection',()=>{
  assert.equal(nodeId(Array(32).fill(15)),'0f'.repeat(32));
  assert.equal(new State(Array(32).fill(255)).node,'ff'.repeat(32));
});
const position={node:'node-a',timestamp_ms:'1',sequence:'18446744073709551615'};
const report={requests:{items:[{position}],has_more:true}};
test('cursor pagination retains prior geometry and rejects stale or incomplete observations',()=>{
  const state=new State('node-a'),generation=state.start();
  assert(state.accept({cursor:'9',all:false,view:{report,connected:true,refreshing:false}},generation));
  assert(state.turn(2));assert.equal(state.data(),report);assert.equal(state.query.before.sequence,position.sequence);
  const next=state.start();assert(!state.accept({cursor:'10',all:false,view:{}},generation));
  assert(state.accept({cursor:'1',all:false,view:{report,connected:true,refreshing:true}},next));
  assert.equal(state.data(),report);assert(!state.ready());assert(!state.turn(3));
  assert(state.accept({cursor:'11',all:false,view:{report,connected:true,refreshing:false}},next));
  assert(!state.accept({cursor:'9',all:false,view:null},next));assert(state.ready());
  assert(state.turn(1));assert.equal(state.query.before,null);
});
test('bound pages reject aggregate reports and page-level host retargeting',()=>{
  const state=new State('a'),generation=state.start();
  assert(!state.select('host','all'));assert(!state.select('host','b'));assert.equal(state.node,'a');
  assert(!state.accept({cursor:'1',all:true,view:{summary:report,complete:true}},generation));
  assert.equal(state.data(),null);assert(!state.turn(2));
  assert(state.accept({cursor:'2',all:false,view:{report,connected:true,refreshing:false}},generation));assert(state.turn(2));
});
test('revoked access clears retained pagination data while transient errors preserve it',()=>{
  for(const code of ['not_configured','not_found','permission_denied','revision_conflict']) {
    const state=new State('a'),generation=state.start();
    state.accept({cursor:'1',all:false,view:{report,connected:true,refreshing:false}},generation);
    assert(state.turn(2));const next=state.start();
    state.accept({cursor:'1',all:false,view:{report:null,connected:true,refreshing:false,error:{code:'unavailable'}}},next);
    assert.equal(state.data(),report);
    state.accept({cursor:'2',all:false,view:{report:null,connected:true,refreshing:false,error:{code}}},next);
    assert.equal(state.data(),null);assert.equal(state.previous,null);assert(!state.ready());
    state.accept({cursor:'3',all:false,view:{report,connected:true,refreshing:false,error:null}},next);
    assert.equal(state.data(),report);assert(state.ready());
  }
});
test('filter changes reset dependent fields and preserve frozen deleted model choices',()=>{
  const state=new State('a');state.query.providers=['p'];state.query.models=['removed'];state.query.projects=['x'];
  state.select('range','30');assert.deepEqual(state.query.models,['removed']);
  const options=choices(state,{projects:[],providers:[]},[{kind:'model',data:{provider:'p',model:'old'}}],text);
  assert(options.model.some(item=>item.id==='old'));assert(options.model.some(item=>item.id==='removed'));
  state.select('project','next');assert.deepEqual(state.query.providers,[]);assert.deepEqual(state.query.models,[]);
  assert.equal(query(7,Date.UTC(2026,8,30,23)).end_ms,Date.UTC(2026,9,1));
});
test('filter reads retain prior reports until current data arrives',()=>{
  for(const field of ['range','project','provider','model']) {
    const state=new State('a'),generation=state.start();
    state.accept({cursor:'1',all:false,view:{report,connected:true,refreshing:false}},generation);
    assert(state.select(field,field==='range'?'30':'selected'));
    const next=state.start(),replacement={requests:{items:[],has_more:false}};
    assert.equal(state.data(),report);assert(!state.ready());
    assert(!state.accept({cursor:'2',all:false,view:{report:replacement,connected:true,refreshing:false}},generation));
    assert.equal(state.data(),report);
    assert(state.accept({cursor:'1',all:false,view:{report:replacement,connected:true,refreshing:true}},next));
    assert.equal(state.data(),report);assert(!state.ready());
    assert(state.accept({cursor:'2',all:false,view:{report:null,connected:true,refreshing:false,error:{code:'unavailable'}}},next));
    assert.equal(state.data(),report);assert(!state.ready());
    assert(state.accept({cursor:'3',all:false,view:{report:replacement,connected:true,refreshing:false,error:null}},next));
    assert.equal(state.data(),replacement);assert(state.ready());
  }
});
test('composer defaults empty displays and preserves context thresholds',()=>{
  const state={has_messages:true},before=structuredClone(state),unknown=metrics(state,text);
  assert.deepEqual(unknown.slice(0,-1).map(metric=>metric.value),['0','0','0.00','0','0']);
  assert.deepEqual(unknown.slice(0,-1).map(metric=>metric.details.map(detail=>detail.value)),[
    ['0','0'],['0','0','0'],['$0.00','$0.00'],['0','0','0'],['0']]);
  assert.equal(unknown.at(-1).value.percent,null);assert.equal(unknown.at(-1).value.hint,text.composer_context_unknown);
  assert.deepEqual(state,before);
  const zero=metrics({has_messages:true,statistics:{usage:{input:'0',output:'0',cached_input:'0',reasoning:'0'},context_tokens:'100'},context_limit:100,compacting:true},text);
  assert.equal(zero[0].value,'0');assert.equal(zero.at(-1).value.tone,'danger');assert(zero.at(-1).value.loading);
});
test('footer keeps units counts and empty money displays',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../plugin.json',import.meta.url),'utf8'));
  const icons=Object.fromEntries(manifest.extensions['dev.sailry.platform'].ui.map(entry=>[entry.id,entry.icon]));
  assert.equal(icons.composer_speed,'gauge');assert.equal(icons.composer_cost,'dollar-sign');assert.equal(icons.composer_turns,'messages-square');
  for(const locale of ['en','zh-CN']) {
    const text=messages(locale),statistics={turns:'7',responses:'12',generation:{output_tokens:'43',elapsed_us:'2000000',responses:'3'},cost:null};
    const before=structuredClone(statistics),values=metrics({has_messages:true,statistics},text);
    const metric=id=>values.find(value=>value.id===id);
    assert.equal(metric('composer_speed').value,'21.5/s');assert.equal(metric('composer_turns').value,'7');
    assert.equal(metric('composer_turns').details[0].value,'12');assert.equal(metric('composer_cost').value,'0.00');
    assert.deepEqual(metric('composer_cost').details,[
      {label:{label:text.composer_this_session},value:'$0.00'},
      {label:{label:text.composer_subagents},value:'$0.00'}]);
    assert.deepEqual(statistics,before);
    const zero=metrics({has_messages:true,statistics:{...statistics,cost:{usd_micros:'0',responses:'12',breakdown:{input:'0',output:'0',cache_read:'0',cache_write:'0'}}}},text).find(value=>value.id==='composer_cost');
    assert.equal(zero.value,'0.00');assert.equal(zero.details[0].value,'$0.00');assert.equal(zero.details[1].value,'$0.00');
  }
});

test('composer combines child totals and preserves own metrics',()=>{
  const statistics={turns:'7',responses:'2',context_tokens:'60',
    usage:{input:'100',output:'20',cached_input:'25',reasoning:'5'},
    generation:{output_tokens:'43',elapsed_us:'2000000',responses:'2'},
    cost:{usd_micros:'15000',responses:'2'},
    delegated:{responses:'3',tokens:{input:'200',output:'80',cached_input:'200',reasoning:'50'},
      cost:{usd_micros:'15000',responses:'3'},
      generation:{output_tokens:'4000',elapsed_us:'1',responses:'3'}}};
  const before=structuredClone(statistics);
  for(const locale of ['en','zh-CN']) {
    const text=messages(locale),values=metrics({has_messages:true,statistics,context_limit:100},text);
    const metric=id=>values.find(value=>value.id===id);
    assert.equal(metric('composer_tokens').value,'400');
    assert.deepEqual(metric('composer_tokens').details,[
      {label:{label:text.composer_this_session},value:'120'},
      {label:{label:text.composer_subagents},value:'280'}]);
    assert.equal(metric('composer_cost').value,'0.03');
    assert.deepEqual(metric('composer_cost').details,[
      {label:{label:text.composer_this_session},value:'$0.01'},
      {label:{label:text.composer_subagents},value:'$0.01'}]);
    assert.equal(metric('composer_speed').value,'21.5/s');
    assert.deepEqual(metric('composer_speed').details.map(detail=>detail.value),['2','43','0']);
    assert.equal(metric('composer_cache').value,'25%');
    assert.deepEqual(metric('composer_cache').details.map(detail=>detail.value),['25','75','100']);
    assert.equal(metric('composer_turns').value,'7');
    assert.equal(metric('composer_turns').details[0].value,'2');
    assert.equal(metric('context').value.percent,60);
    assert.equal(metric('context').value.hint,'60 / 100');
    assert.ok(text.composer_this_session && text.composer_subagents);
  }
  assert.equal(messages('en').composer_this_session,'This session');
  assert.equal(messages('en').composer_subagents,'Subagents');
  assert.equal(messages('zh-CN').composer_this_session,'本会话');
  assert.equal(messages('zh-CN').composer_subagents,'子代理');
  assert.deepEqual(statistics,before);
});

test('composer defaults absent children without changing own values',()=>{
  const statistics={turns:'4',responses:'2',usage:{input:'100',output:'20',cached_input:'0',reasoning:'0'},
    cost:{usd_micros:'30000',responses:'1'}};
  const state={has_messages:true,statistics};
  const absent=metrics(state,text),empty=metrics({...state,statistics:{...statistics,
    delegated:{responses:'0',tokens:null,cost:null,generation:null}}},text);
  assert.deepEqual(absent,empty);
  const metric=id=>absent.find(value=>value.id===id);
  assert.equal(metric('composer_tokens').value,'120');
  assert.deepEqual(metric('composer_tokens').details.map(detail=>detail.value),['120','0']);
  assert.equal(metric('composer_cost').value,'0.03+');
  assert.deepEqual(metric('composer_cost').details.map(detail=>detail.value),['$0.03+','$0.00']);
});

test('composer retains partial prices and exact microdollar sums',()=>{
  const statistics={responses:'2',cost:{usd_micros:'9007199254749998',responses:'1'},
    delegated:{responses:'3',cost:{usd_micros:'1',responses:'2'}}};
  let values=metrics({has_messages:true,statistics},text);
  let charge=values.find(value=>value.id==='composer_cost');
  assert.equal(charge.value,'9007199254.74+');
  assert.deepEqual(charge.details.map(detail=>detail.value),['$9007199254.74+','$0.00+']);
  values=metrics({has_messages:true,statistics:{responses:'2',cost:null,
    delegated:{responses:'3',cost:{usd_micros:'20000',responses:'3'}}}},text);
  charge=values.find(value=>value.id==='composer_cost');
  assert.equal(charge.value,'0.02+');
  assert.deepEqual(charge.details.map(detail=>detail.value),['$0.00','$0.02']);
});
test('requests preserve exact token details and complete identity despite rounded display',()=>{
  const request={position,model:'model',provider_name:'Removed provider',scope_name:'Removed project',tokens:{input:'18446744073709551615',output:'1',cached_input:'0',reasoning:'0'},first_token_us:'1250',elapsed_us:'1000000',usd_micros:null};
  const rows=formatRows([request],text);assert.equal(rows.rows[0].length,6);assert.equal(rows.cells[0].length,6);
  assert.equal(rows.rows[0][2],`${request.tokens.input} · 1`);assert.equal(rows.details[0][2],`Input: ${request.tokens.input}\nOutput: 1`);
  assert.equal(rows.cells[0][4].primary.text,'1.3 ms');assert.equal(rows.cells[0][4].secondary.text,'1.00 s');assert.equal(rows.rows[0][5],'—');
  assert.equal(rows.details[0][4],'First token: 1250 µs\nDuration: 1000000 µs');
  assert.equal(rows.row_ids[0],`node-a:1:${position.sequence}`);assert.equal(rows.details[0][0],'Model: model\nProvider: Removed provider');
  assert.notEqual(rows.cells[0][2].primary.icon,rows.cells[0][2].secondary.icon);
  assert.notEqual(rows.cells[0][2].primary.tone,rows.cells[0][2].secondary.tone);
});
test('unassigned requests use a localized scope without changing response identity',()=>{
  const request={session:'session-a',position,model:'model',provider_name:'Provider',scope_name:'',
    tokens:{input:'12',output:'4',cached_input:'0',reasoning:'0'},first_token_us:null,elapsed_us:null,usd_micros:null};
  for(const locale of ['en','zh-CN']) {
    const text=messages(locale),rows=formatRows([request],text);
    assert.equal(rows.cells[0][1].primary.text,text.usage_unassigned);assert(rows.details[0][1].includes(text.usage_unassigned));
    assert.equal(rows.row_ids[0],`node-a:1:${position.sequence}`);
    assert.equal(rows.rows[0][2],'12 · 4');
  }
});
test('request cells keep missing counters unknown and exact microdollar costs available',()=>{
  const request={position,model:'model',provider_name:'Provider',scope_name:'Project',tokens:{input:null,output:'0',cached_input:null,reasoning:'0'},
    first_token_us:null,elapsed_us:null,usd_micros:'18446744073709551615'};
  const rows=formatRows([request],text);
  assert.equal(rows.cells[0][2].primary.text,'—');assert.equal(rows.cells[0][2].secondary.text,'0');
  assert.equal(rows.details[0][2],'Input: —\nOutput: 0');assert.equal(rows.details[0][3],'Cached: —\nReasoning: 0');
  assert.equal(rows.details[0][4],'First token: —\nDuration: —');
  assert.equal(rows.rows[0][5],'18446744073709.551615');assert.equal(rows.details[0][5],rows.rows[0][5]);
});
