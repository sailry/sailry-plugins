import test from 'node:test';
import assert from 'node:assert/strict';
import {metrics} from '../dev.sailry.platform/desktop/metrics.js';
import {messages} from '../dev.sailry.platform/desktop/locales.js';

const metric=(values,id)=>values.find(value=>value.id===id);
const own={input:'100',output:'20',cached_input:'25',reasoning:'0'};
const child={input:'200',output:'80',cached_input:'0',reasoning:'0'};
const unfilled=values=>values.flatMap(value=>[value.value,...value.details.flatMap(detail=>[detail.label.label,detail.value])])
  .filter(text=>text.includes('%{'));
const locales={
  en:{subtotal:value=>`Subtotal: ${value}`,coverage:(reported,responses)=>`${reported} of ${responses} responses reported both token counts`},
  'zh-CN':{subtotal:value=>`小计：${value}`,coverage:(reported,responses)=>`${reported} / ${responses} 个响应报告了输入和输出 Token`},
};

test('complete own and delegated tokens stay exact without coverage',()=>{
  for(const locale of Object.keys(locales)) {
    const statistics={turns:'1',responses:'2',usage:own,delegated:{responses:'3',tokens:child}};
    const values=metrics({has_messages:true,statistics},messages(locale));
    assert.equal(metric(values,'composer_tokens').value,'400');
    assert.deepEqual(metric(values,'composer_tokens').details.map(detail=>detail.value),['120','280']);
    assert.equal(metric(values,'composer_cache').value,'25%');
    assert.equal(metric(values,'composer_cache').details.length,3);
  }
});

test('incomplete own tokens render as a subtotal with coverage and no cache rate',()=>{
  for(const [locale,expect] of Object.entries(locales)) {
    const text=messages(locale),statistics={turns:'1',responses:'3',incomplete_token_responses:'1',usage:own,
      delegated:{responses:'3',tokens:child}};
    const before=structuredClone(statistics),values=metrics({has_messages:true,statistics},text);
    const tokens=metric(values,'composer_tokens'),rate=metric(values,'composer_cache');
    assert.equal(tokens.value,expect.subtotal('400'));assert.equal(tokens.visible,true);
    assert.deepEqual(tokens.details,[
      {label:{label:text.composer_this_session},value:expect.subtotal('120')},
      {label:{label:text.composer_subagents},value:'280'},
      {label:{label:expect.coverage('5','6')},value:''}]);
    assert.equal(rate.value,text.composer_metric_unknown);assert.equal(rate.visible,true);
    assert.deepEqual(rate.details.map(detail=>detail.value),['25','75','100','']);
    assert.equal(rate.details[3].label.label,expect.coverage('2','3'));
    assert.deepEqual(unfilled(values),[]);
    assert.deepEqual(statistics,before);
  }
});

test('incomplete delegated tokens mark only the combined and subagent figures',()=>{
  for(const [locale,expect] of Object.entries(locales)) {
    const statistics={turns:'1',responses:'2',usage:own,
      delegated:{responses:'4',incomplete_token_responses:'2',tokens:child}};
    const values=metrics({has_messages:true,statistics},messages(locale));
    assert.equal(metric(values,'composer_tokens').value,expect.subtotal('400'));
    assert.deepEqual(metric(values,'composer_tokens').details.map(detail=>detail.value),['120',expect.subtotal('280'),'']);
    assert.equal(metric(values,'composer_tokens').details[2].label.label,expect.coverage('4','6'));
    assert.equal(metric(values,'composer_cache').value,'25%');
    assert.deepEqual(unfilled(values),[]);
  }
});

test('absent subtotals beside responses never pass for complete counts',()=>{
  for(const [locale,expect] of Object.entries(locales)) {
    const text=messages(locale);
    // Every own response lacked a count, so the child total must not read as the session total.
    let values=metrics({has_messages:true,statistics:{turns:'1',responses:'2',incomplete_token_responses:'2',usage:null,
      delegated:{responses:'1',tokens:child}}},text);
    assert.equal(metric(values,'composer_tokens').value,expect.subtotal('280'));
    assert.deepEqual(metric(values,'composer_tokens').details.map(detail=>detail.value),[text.composer_metric_unknown,'280','']);
    assert.equal(metric(values,'composer_tokens').details[2].label.label,expect.coverage('1','3'));
    assert.equal(metric(values,'composer_cache').visible,false);
    assert.deepEqual(unfilled(values),[]);
    // Hosts predating incomplete_token_responses report unknown delegated tokens as null.
    values=metrics({has_messages:true,statistics:{turns:'1',responses:'2',usage:own,
      delegated:{responses:'2',tokens:null}}},text);
    assert.equal(metric(values,'composer_tokens').value,expect.subtotal('120'));
    assert.deepEqual(metric(values,'composer_tokens').details.map(detail=>detail.value),
      ['120',text.composer_metric_unknown,'']);
    assert.equal(metric(values,'composer_tokens').details[2].label.label,expect.coverage('2','4'));
    assert.equal(metric(values,'composer_cache').value,'25%');
    // Neither side reported counts: the tokens figure stays hidden rather than showing zero.
    values=metrics({has_messages:true,statistics:{turns:'1',responses:'2',usage:null,
      delegated:{responses:'1',tokens:null}}},text);
    assert.equal(metric(values,'composer_tokens').visible,false);
    assert.equal(metric(values,'composer_tokens').value,text.composer_metric_unknown);
    assert.equal(metric(values,'composer_tokens').details[2].label.label,expect.coverage('0','3'));
    assert.deepEqual(unfilled(values),[]);
  }
});

test('hosts without the coverage field and sessions without children stay exact',()=>{
  for(const locale of Object.keys(locales)) {
    const text=messages(locale);
    for(const delegated of [undefined,{responses:'0',tokens:null,cost:null,generation:null}]) {
      const values=metrics({has_messages:true,statistics:{turns:'1',responses:'2',usage:own,delegated}},text);
      assert.equal(metric(values,'composer_tokens').value,'120');
      assert.deepEqual(metric(values,'composer_tokens').details.map(detail=>detail.value),['120',text.composer_metric_unknown]);
      assert.equal(metric(values,'composer_cache').value,'25%');
    }
    const empty=metrics({has_messages:false,statistics:null},text);
    assert(empty.every(value=>!value.visible));
    assert.deepEqual(unfilled(empty),[]);
  }
});
