import test from 'node:test';
import assert from 'node:assert/strict';
import {details} from '../dev.sailry.platform/desktop/context.js';
import {metrics} from '../dev.sailry.platform/desktop/metrics.js';
import {messages} from '../dev.sailry.platform/desktop/locales.js';
const text=messages('en');
const row=(state,id)=>details(state,text).find(row=>row.id===id);
const indicator=state=>metrics(state,text).find(entry=>entry.id==='context');

test('unknown occupancy stays unknown in every layout',()=>{
  for(const sidebar of [true,false]) {
    const state={sidebar,statistics:null};
    assert.equal(indicator(state).value.percent,null);
    assert.equal(indicator(state).visible,true);
    assert.equal(row(state,'occupancy').value,text.context_no_data);
    assert.equal(row(state,'compaction').target,null);
  }
});
test('model changes preserve observed capacity',()=>{
  const state={statistics:{context_tokens:'800',context_limit:'1000',context_model:'previous',
    budget:{model:'current',context_limit:'10000',trigger_tokens:'7400',output_reserve:'1200'}}};
  assert.equal(indicator(state).value.percent,80);
  assert.equal(row(state,'occupancy').value,'800 / 1,000');
  assert.equal(row(state,'basis').note,'previous');
  assert.equal(row(state,'threshold').value,'7,400');
  assert.equal(row(state,'threshold').note,'current · 10,000');
  assert.equal(row(state,'reserve').value,'1,200');
});
test('new observation replaces the estimate',()=>{
  const state={statistics:{context_estimate:'240',context_limit:'1000'}};
  assert.equal(row(state,'occupancy').value,'≈ 240 / 1,000');
  assert.equal(row(state,'basis').value,text.context_basis_estimate);
  state.statistics.context_tokens='300';
  assert.equal(row(state,'occupancy').value,'300 / 1,000');
  assert.equal(row(state,'basis').value,text.context_basis_observed);
  assert.equal(indicator(state).value.percent,30);
});
test('canonical references retain exact turn cursors',()=>{
  const record={id:'event',sequence:'9007199254740995',turn:'turn',turn_sequence:'9007199254740993',timestamp_ms:'1',outcome:'succeeded'};
  const state={statistics:{last_compaction:record}};
  assert.deepEqual(row(state,'compaction').target,{entry:'event',turn:'turn',turn_sequence:'9007199254740993'});
  assert.equal(row(state,'compaction').value,text.context_succeeded);
  record.outcome={failed:{reason:'empty_summary'}};
  assert.equal(row(state,'compaction').value,text.context_failed);
});
test('metrics avoid double counting cache and reasoning',()=>{
  const state={has_messages:true,statistics:{usage:{input:'100',output:'25',cached_input:'60',reasoning:'10'}}};
  const entries=metrics(state,text,true,{id:'context',sequence:'9'});
  assert.equal(entries.find(entry=>entry.id==='composer_tokens').value,'125');
  assert.equal(entries.find(entry=>entry.id==='composer_cost').value,text.composer_metric_unknown);
  assert.equal(entries.find(entry=>entry.id==='context').value.open,true);
  assert.equal(entries.find(entry=>entry.id==='context').reply_to,'9');
});
test('context copy exists in every supported locale',()=>{
  for(const locale of ['en','zh-CN','zh-TW','de','es','fr','ja','ko','pt-BR','ru']) {
    const localized=messages(locale);
    assert.ok(localized.context_basis && localized.context_reserve && localized.context_view_record);
  }
});
