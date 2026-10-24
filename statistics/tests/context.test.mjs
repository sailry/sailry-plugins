import test from 'node:test';
import assert from 'node:assert/strict';
import {overview,history,connection,timing,latency,shares,CATEGORIES} from '../dev.sailry.platform/desktop/context.js';
import {metrics} from '../dev.sailry.platform/desktop/metrics.js';
import {messages} from '../dev.sailry.platform/desktop/locales.js';
const text=messages('en');
const indicator=state=>metrics(state,text).find(entry=>entry.id==='context');
const parts=value=>CATEGORIES.map(([kind])=>({kind,items:'1',tokens:value,method:'estimate'}));
const attempt=(values={})=>({index:'1',transport:'http',complete_context:true,categories:parts('10'),usage:null,
  headers_us:null,first_text_us:null,elapsed_us:null,reasoning_reported:false,cache_reported:false,...values});
const request=(id,values={})=>({id,turn:id,turn_index:'1',model:'previous',context_limit:'1000',attempts:[attempt()],...values});

test('partial categories keep their observed share',()=>{
  const parts=[{id:'measured',value:20n},{id:'unknown',value:null}];
  assert.deepEqual(shares(parts,100n),[{id:'measured',value:20n,share:20}]);
  assert.deepEqual(shares(parts),[]);
  assert.deepEqual(shares(parts,0n),[]);
  assert.deepEqual(parts,[{id:'measured',value:20n},{id:'unknown',value:null}]);
});

test('complete categories can use their recorded total',()=>{
  assert.deepEqual(shares([{value:20n},{value:30n},{value:0n}]),[
    {value:20n,share:40},{value:30n,share:60},
  ]);
});

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
    request('old',{turn_index:'9007199254740994',attempts:[attempt({headers_us:'10'})]}),
    request('latest',{turn_index:'9007199254740995',attempts:[attempt({headers_us:'20'})]}),
  ]}}};
  const selected=overview(state,'old');
  assert.equal(selected.chosen.id,'old');
  assert.equal(selected.chosen.step,9007199254740994n);
  assert.equal(selected.used.tokens,300n);
  assert.equal(selected.connection.headers,20n);
  assert.equal(overview(state,'removed').chosen.id,'latest');
});
test('each round keeps its latest request and attempt',()=>{
  const usage=(input,output='5')=>({input,output});
  const recent=[
    request('first-start',{turn:'first',turn_index:'1',attempts:[attempt({usage:usage('100')})]}),
    request('first-tools',{turn:'first',turn_index:'1',attempts:[attempt({usage:usage('200')})]}),
    request('second-start',{turn:'second',turn_index:'2',attempts:[attempt({usage:usage('300')})]}),
    request('second-recovery',{turn:'second',turn_index:'2',attempts:[
      attempt({index:'1',usage:usage('400'),outcome:'failed'}),
      attempt({index:'2',usage:usage('500'),outcome:'succeeded'}),
    ]}),
  ];
  const statistics={turns:'2',observations:{calls:'4',recent}};
  const before=overview({statistics},'first');
  assert.deepEqual(before.snapshots.map(value=>[value.id,value.step,value.tokens]),[
    ['first',1n,205n],['second',2n,505n],
  ]);
  assert.equal(before.usage.steps,2n);
  assert.equal(before.chosen.request,'first-tools');
  recent.push(request('second-end',{turn:'second',turn_index:'2',attempts:[attempt({usage:usage('600')})]}));
  const updated=overview({statistics},'second');
  assert.equal(updated.chosen.id,'second');
  assert.equal(updated.chosen.request,'second-end');
  assert.equal(updated.chosen.tokens,605n);
  assert.equal(updated.snapshots.length,2);
  assert.equal(overview({statistics},'first').chosen.request,'first-tools');
});
test('bounded requests retain canonical round numbers',()=>{
  const recent=Array.from({length:64},(_,index)=>request(`call-${index}`,{
    turn:index<60?'earlier':'latest',turn_index:index<60?'99':'100',
  }));
  assert.deepEqual(history({turns:'100',observations:{calls:'9000',recent}}).map(value=>value.step),[99n,100n]);
});
test('missing round attribution never invents steps',()=>{
  for(const values of [{turn:null},{turn:''},{turn:undefined},{turn_index:null},{turn_index:undefined},{turn_index:'0'}]) {
    const statistics={turns:'2',observations:{calls:'4',recent:[request('unknown',values)]}};
    assert.deepEqual(history(statistics),[]);
    assert.equal(overview({statistics}).chosen,null);
    assert.equal(overview({statistics}).connection.transport,'http');
  }
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
test('session average replaces short request windows',()=>{
  const latest=attempt({index:'2',headers_us:'6100000',first_text_us:'6888200',elapsed_us:'6891237',
    usage:{input:'24200',output:'14',reasoning:'1',cached_input:'0'},reasoning_reported:true});
  const state={has_messages:true,statistics:{responses:'1',
    generation:{responses:'1',output_tokens:'14',elapsed_us:'8200000'},observations:{
      output_tokens:'13',output_us:'3037',output_samples:'1',recent:[request('last',{attempts:[
        attempt({transport:'web_socket',elapsed_us:'1308763',outcome:'failed'}),latest,
      ]})],
    }}};
  const before=structuredClone(state);
  assert.equal((13*1000000/(Number(latest.elapsed_us)-Number(latest.first_text_us))).toFixed(1),'4280.5');
  const value=overview(state);
  assert.equal(metrics(state,text).find(entry=>entry.id==='composer_speed').value,'1.7/s');
  assert.equal(value.connection.speed,'1.7');
  assert.equal(value.timing.speed,'1.7');
  assert.equal(value.connection.response,6100000n);
  assert.equal(value.connection.first,6888200n);
  assert.equal(value.connection.elapsed,6891237n);
  assert.equal(value.connection.waiting,788200n);
  assert.deepEqual(state,before);
});

test('multiple requests retain full output and session timing',()=>{
  const state={has_messages:true,statistics:{responses:'3',
    usage:{input:'300',output:'56',reasoning:'4',cached_input:'0'},
    generation:{responses:'3',output_tokens:'56',elapsed_us:'20000000'},observations:{recent:[
      request('first',{attempts:[attempt({elapsed_us:'10000000',first_text_us:'9000000',
        usage:{input:'100',output:'20',reasoning:'1',cached_input:'0'}})]}),
      request('second',{turn_index:'2',attempts:[attempt({elapsed_us:'3108763',first_text_us:'3000000',
        usage:{input:'100',output:'22',reasoning:'2',cached_input:'0'}})]}),
      request('third',{turn_index:'3',attempts:[attempt({elapsed_us:'6891237',first_text_us:'6888200',
        usage:{input:'100',output:'14',reasoning:'1',cached_input:'0'},reasoning_reported:false})]}),
    ]}}};
  const value=overview(state,'first');
  assert.equal(value.chosen.id,'first');
  assert.equal(metrics(state,text).find(entry=>entry.id==='composer_speed').value,'2.8/s');
  assert.equal(value.connection.speed,'2.8');
  assert.equal(value.timing.speed,'2.8');
  assert.equal(value.usage.output,56n);
  state.statistics.observations.recent.at(-1).attempts.push(attempt({index:'2',outcome:'failed'}));
  assert.equal(overview(state).connection.first,null);
  assert.equal(overview(state).connection.elapsed,null);
  assert.equal(overview(state).connection.speed,'2.8');
});

test('session averages preserve historical and unknown timing',()=>{
  const observations={output_tokens:'13',output_us:'3037',output_samples:'1',recent:[request('old',{
    attempts:[attempt({elapsed_us:'6891237',first_text_us:'6888200',
      usage:{input:'100',output:'14',reasoning:'1',cached_input:'0'},reasoning_reported:true})],
  })]};
  for(const generation of [null,undefined,{output_tokens:'14'},{output_tokens:'14',elapsed_us:'0'}]) {
    const state={has_messages:true,statistics:{generation,observations,first_token_us:'10'}};
    const footer=metrics(state,text).find(entry=>entry.id==='composer_speed');
    assert.equal(footer.visible,false);
    assert.equal(footer.value,text.composer_metric_unknown);
    assert.equal(overview(state).connection.speed,null);
    assert.equal(overview(state).timing.speed,null);
  }
  const state={has_messages:false,statistics:{responses:'1',
    generation:{responses:'1',output_tokens:'14',elapsed_us:'8200000'}}};
  assert.equal(metrics(state,text).find(entry=>entry.id==='composer_speed').value,'1.7/s');
  assert.equal(overview(state).connection.speed,'1.7');
  assert.equal(overview(state).timing.speed,'1.7');
  assert.equal(overview(state).connection.elapsed,null);
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
  assert.equal(latency('3000000'),'destructive');
  assert.equal(latency('10000000','waiting'),'success');
  assert.equal(latency('10000001','waiting'),'warning');
  assert.equal(latency('15000000','waiting'),'destructive');
  const value=connection({}, {attempt:attempt({response_us:'-1',first_text_us:'invalid',elapsed_us:'10'})});
  assert.equal(value.response,null);
  assert.equal(value.first,null);
  assert.equal(value.waiting,null);
});
test('active phases never infer thinking from token ratios',()=>{
  const value=timing({model_us:'8000000',output_us:'1000000',output_tokens:'30',output_samples:'1',
    phases:{active_us:'4000000',waiting_us:'1000000',output_us:'1000000',tools_us:'2000000',other_us:'0'}},
    {elapsed_us:'2000000',output_tokens:'30'});
  assert.equal(value.active,4000000n);
  assert.equal(value.speed,'15.0');
  assert.equal(value.rows.find(row=>row.id==='thinking').value,null);
  assert.equal(value.rows.find(row=>row.id==='arguments').value,null);
  assert.equal(timing({model_us:'8000000'}).active,null);
});
test('all supported locales include the five sections',()=>{
  for(const locale of ['en','zh-CN','zh-TW','de','es','fr','ja','ko','pt-BR','ru']) {
    const localized=messages(locale);
    for(const key of ['title','session_usage','session_time','connection','composition','details','payload_partial','output_speed']) {
      assert.equal(typeof localized[`context_${key}`],'string');
      assert.ok(localized[`context_${key}`].length);
    }
  }
  assert.equal(messages('zh-CN').context_output_speed,'会话均速');
  assert.equal(messages('en').context_output_speed,'Session average');
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
