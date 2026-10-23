import test from 'node:test';
import assert from 'node:assert/strict';
import {overview,history,connection,timing,latency,CATEGORIES} from '../dev.sailry.platform/desktop/context.js';
import {metrics} from '../dev.sailry.platform/desktop/metrics.js';
import {messages} from '../dev.sailry.platform/desktop/locales.js';
const text=messages('en');
const indicator=state=>metrics(state,text).find(entry=>entry.id==='context');
const parts=value=>CATEGORIES.map(([kind])=>({kind,items:'1',tokens:value,method:'estimate'}));
const attempt=(values={})=>({index:'1',transport:'http',complete_context:true,categories:parts('10'),usage:null,
  headers_us:null,first_text_us:null,elapsed_us:null,reasoning_reported:false,cache_reported:false,...values});
const request=(id,values={})=>({id,model:'previous',context_limit:'1000',attempts:[attempt()],...values});

test('unknown occupancy stays unknown while entry remains available',()=>{
  for(const sidebar of [true,false]) {
    const state={sidebar,statistics:null};
    assert.equal(indicator(state).value.percent,null);
    assert.equal(indicator(state).visible,true);
    assert.equal(overview(state).used.tokens,null);
    assert.equal(overview({...state,model:'new',context_limit:1000}).used.limit,1000n);
    assert.equal(overview(state).connection.headers,null);
    assert.deepEqual(metrics(state,text).filter(entry=>entry.visible).map(entry=>entry.id),['context_panel','context']);
  }
});
test('model changes do not reuse old tokens',()=>{
  const statistics={context_tokens:'800',context_limit:'1000',context_model:'previous',
    budget:{model:'current',context_limit:'10000',trigger_tokens:'7400',output_reserve:'1200'}};
  assert.equal(overview({statistics}).used.percent,80);
  assert.equal(overview({statistics}).used.threshold,null);
  const state={model:'current',context_limit:'10000',statistics};
  const current=overview(state);
  assert.equal(indicator(state).value.percent,null);
  assert.equal(indicator(state).value.hint,'0');
  assert.equal(current.used.tokens,null);
  assert.equal(current.used.limit,10000n);
  assert.equal(current.used.threshold,7400n);
  assert.equal(current.used.reserve,1200n);
});
test('new observation replaces the estimate',()=>{
  const state={statistics:{context_estimate:'240',context_limit:'1000'}};
  assert.equal(overview(state).used.estimated,true);
  state.statistics.context_tokens='300';
  assert.equal(overview(state).used.tokens,300n);
  assert.equal(overview(state).used.estimated,false);
  assert.equal(indicator(state).value.percent,30);
});
test('history selection leaves current occupancy and connection intact',()=>{
  const state={statistics:{context_tokens:'300',context_limit:'1000',context_model:'previous',observations:{calls:'9007199254740995',recent:[
    request('old',{attempts:[attempt({headers_us:'10'})]}),
    request('latest',{attempts:[attempt({headers_us:'20'})]}),
  ]}}};
  const selected=overview(state,'old');
  assert.equal(selected.chosen.id,'old');
  assert.equal(selected.chosen.step,9007199254740994n);
  assert.equal(selected.used.tokens,300n);
  assert.equal(selected.connection.headers,20n);
  assert.equal(overview(state,'removed').chosen.id,'latest');
});
test('partial payloads never become a complete window estimate',()=>{
  const values=history({observations:{recent:[request('partial',{attempts:[attempt({complete_context:false})]})]}});
  assert.equal(values[0].tokens,null);
  assert.equal(values[0].parts[0].tokens,10n);
  assert.equal(values[0].complete,false);
  const incomplete=history({observations:{recent:[request('unknown',{attempts:[attempt({categories:parts(null)})]})]}});
  assert.equal(incomplete[0].tokens,null);
});
test('latest failed attempt does not borrow successful timing',()=>{
  const values=overview({statistics:{observations:{recent:[request('call',{attempts:[
    attempt({headers_us:'100',first_text_us:'200',elapsed_us:'500',status:200}),
    attempt({outcome:'failed',status:503}),
  ]})]}}});
  assert.equal(values.connection.headers,null);
  assert.equal(values.connection.first,null);
  assert.equal(values.connection.status,503);
});
test('metrics count cache and reasoning only once',()=>{
  const state={has_messages:true,statistics:{usage:{input:'100',output:'25',cached_input:'60',reasoning:'10'},
    observations:{cache_read:'60',reasoning:'10',children:'0',tools:{read:'2',write:'1'}}}};
  const value=overview(state);
  assert.equal(value.usage.total,125n);
  assert.equal(value.usage.cache,60);
  assert.equal(value.usage.toolCount,3n);
  assert.equal(value.usage.skills,null);
  assert.equal(value.usage.injected,null);
  assert.equal(value.usage.children,0n);
  assert.equal(value.composition.at(-1).tokens,15n);
  const entries=metrics(state,text);
  assert.equal(entries.find(entry=>entry.id==='composer_tokens').value,'125');
  assert.equal(entries.find(entry=>entry.id==='composer_cost').visible,false);
  assert.equal(entries.some(entry=>entry.id==='composer_context'),false);
});
test('missing cache attribution remains unknown rather than zero',()=>{
  const value=overview({statistics:{usage:{input:'100',output:'25',cached_input:'0',reasoning:'0'},observations:{cache_read:null,reasoning:null}}});
  assert.equal(value.usage.cached,null);
  assert.equal(value.usage.reasoning,null);
  assert.equal(value.usage.cache,null);
  assert.equal(value.composition.at(-1).tokens,null);
});
test('visible output speed requires separately reported reasoning',()=>{
  const latest={attempt:attempt({headers_us:'100000',first_text_us:'200000',elapsed_us:'1200000',
    usage:{input:'100',output:'30',reasoning:'10',cached_input:'0'}})};
  assert.equal(connection({},latest).speed,null);
  latest.attempt.reasoning_reported=true;
  assert.equal(connection({},latest).speed,20);
  assert.equal(connection({},latest).waiting,100000n);
  latest.attempt.first_text_us='1000000';latest.attempt.elapsed_us='900000';
  assert.equal(connection({},latest).speed,null);
});

test('socket response receipt never borrows handshake timing',()=>{
  const latest={attempt:attempt({transport:'web_socket',headers_us:'20',response_us:'80',
    first_text_us:'140',elapsed_us:'300'})};
  let value=connection({},latest);
  assert.equal(value.headers,20n);
  assert.equal(value.response,80n);
  assert.equal(value.waiting,60n);
  delete latest.attempt.response_us;
  value=connection({},latest);
  assert.equal(value.response,null);
  assert.equal(value.waiting,null);
  latest.attempt.transport='http';
  assert.equal(connection({},latest).response,20n);
});

test('recovery stages share the selected attempt clock',()=>{
  const attempts=[
    attempt({transport:'web_socket',response_us:'10',first_text_us:'100',elapsed_us:'120',outcome:'failed'}),
    attempt({transport:'web_socket',response_us:'200',first_text_us:'350',elapsed_us:'400'}),
  ];
  const state={statistics:{first_token_us:'9000',observations:{recent:[request('retry',{attempts})]}}};
  assert.equal(overview(state).connection.response,200n);
  assert.equal(overview(state).connection.first,350n);
  assert.equal(overview(state).connection.waiting,150n);
  attempts[1].response_us='360';
  assert.equal(overview(state).connection.waiting,null);
  assert.equal(latency(overview(state).connection.waiting,'waiting'),'muted_foreground');
  attempts[1].response_us=null;
  assert.equal(overview(state).connection.response,null);
});

test('latency colors preserve unknown and stage boundaries',()=>{
  for(const value of [null,undefined,-1,'invalid',1.5]) {
    assert.equal(latency(value),'muted_foreground');
  }
  assert.equal(latency(0),'success');
  assert.equal(latency('1000000'),'success');
  assert.equal(latency('1000001'),'warning');
  assert.equal(latency('3000000'),'danger');
  assert.equal(latency('10000000','waiting'),'success');
  assert.equal(latency('10000001','waiting'),'warning');
  assert.equal(latency('15000000','waiting'),'danger');
  const value=connection({}, {attempt:attempt({response_us:'-1',first_text_us:'invalid',elapsed_us:'10'})});
  assert.equal(value.response,null);
  assert.equal(value.first,null);
  assert.equal(value.waiting,null);
});
test('active phases never infer thinking from token ratios',()=>{
  const value=timing({model_us:'8000000',output_us:'1000000',output_tokens:'30',output_samples:'1',
    phases:{active_us:'4000000',waiting_us:'1000000',output_us:'1000000',tools_us:'2000000',other_us:'0'}});
  assert.equal(value.active,4000000n);
  assert.equal(value.speed,30);
  assert.equal(value.rows.find(row=>row.id==='thinking').value,null);
  assert.equal(value.rows.find(row=>row.id==='arguments').value,null);
  assert.equal(timing({model_us:'8000000'}).active,null);
});
test('all supported locales include the five sections',()=>{
  for(const locale of ['en','zh-CN','zh-TW','de','es','fr','ja','ko','pt-BR','ru']) {
    const localized=messages(locale);
    for(const key of ['title','session_usage','session_time','connection','composition','details','payload_partial']) {
      assert.equal(typeof localized[`context_${key}`],'string');
      assert.ok(localized[`context_${key}`].length);
    }
  }
});

test('partial pricing never becomes the whole session cost',()=>{
  const statistics={responses:'3',cost:{responses:'2',usd_micros:'1000000'}};
  assert.equal(overview({statistics}).usage.cost,null);
  statistics.cost.responses='3';
  assert.equal(overview({statistics}).usage.cost,'1.00');
});


test('restored statistics appear before message pages arrive',()=>{
  const statistics={turns:'2',responses:'3',usage:{input:'100',output:'25',cached_input:'50',reasoning:'0'},
    generation:{responses:'3',output_tokens:'25',elapsed_us:'1000000'},cost:{responses:'3',usd_micros:'1200000'}};
  const initial={has_messages:false,statistics};
  const visible=state=>metrics(state,text).filter(entry=>entry.visible).map(entry=>entry.id);
  assert.deepEqual(visible(initial),visible({...initial,has_messages:true}));
  assert.deepEqual(visible(initial),['composer_tokens','composer_speed','composer_cost','composer_cache','composer_turns','context_panel','context']);
  for(const statistics of [null,{turns:'0',responses:'0'},{turns:'0',responses:'0',usage:{input:'0',output:'0',cached_input:'0',reasoning:'0'}}]) {
    assert.deepEqual(visible({has_messages:false,statistics}),['context_panel','context']);
  }
});
