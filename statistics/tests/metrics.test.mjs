import test from 'node:test';
import assert from 'node:assert/strict';
import {metrics} from '../dev.sailry.platform/desktop/metrics.js';
import {messages} from '../dev.sailry.platform/desktop/locales.js';

const metric=(values,id)=>values.find(value=>value.id===id);
const composerSpeed=statistics=>metric(metrics({statistics},messages('en')),'composer_speed');
const detailValues=speed=>speed.details.map(detail=>detail.value);
const own={input:'100',output:'20',cached_input:'25',reasoning:'0'};
const child={input:'200',output:'80',cached_input:'0',reasoning:'0'};
const unfilled=values=>values.flatMap(value=>[value.value,...value.details.flatMap(detail=>[detail.label.label,detail.value])])
  .filter(text=>text.includes('%{'));
const locales={
  en:{subtotal:value=>`Subtotal: ${value}`,coverage:(reported,responses)=>`${reported} of ${responses} responses reported both token counts`},
  'zh-CN':{subtotal:value=>`小计：${value}`,coverage:(reported,responses)=>`${reported} / ${responses} 个响应报告了输入和输出 Token`},
};

test('legacy timing leaves speed measurements unknown',()=>{
  const statistics={responses:'1',first_token_us:'250000',generation:{responses:'1',output_tokens:'90',elapsed_us:'1000000'}};
  const speed=composerSpeed(statistics);
  assert.equal(speed.visible,true);
  assert.equal(speed.value,'—');
  assert.deepEqual(detailValues(speed),['—','—','—']);
});

test('speed uses only the last request and its last attempt',()=>{
  const earlier={usage:{output:'60',reasoning:'10'},first_token_us:'500000',elapsed_us:'1500000'};
  const complete={usage:{output:'90',reasoning:'10'},first_token_us:'1000000',elapsed_us:'3000000'};
  const statistics={responses:'3',first_token_us:'900000',throughput:{output_tokens:'120',elapsed_us:'4000000'},
    observations:{latency:{first_token_us:'750000'},recent:[{attempts:[earlier]},{attempts:[earlier,complete]}]}};
  assert.deepEqual(detailValues(composerSpeed(statistics)),['750.0 ms','40.0 tok/s','1.00 s']);

  const recent=statistics.observations.recent;
  for (const attempts of [[],[earlier,{usage:null,first_token_us:null,elapsed_us:'2000000'}]]) {
    const next={...statistics,observations:{...statistics.observations,recent:[...recent,{attempts}]}};
    const speed=composerSpeed(next);
    assert.equal(speed.value,'30.0 tok/s');
    assert.deepEqual(detailValues(speed),['750.0 ms','—','—']);
  }
});

test('latest generation TPS requires paired timing and reported output',()=>{
  const attempt={usage:{output:'90',reasoning:'15'},first_token_us:'500000',elapsed_us:'2000000'};
  for (const [changes,tps,ttft] of [
    [{},'50.0 tok/s','500.0 ms'],
    [{reasoning_streamed:true},'60.0 tok/s','500.0 ms'],
    [{usage:{output:'0',reasoning:'0'},first_token_us:'0'},'0.0 tok/s','0.0 ms'],
    [{usage:{output:'10',reasoning:'15'}},'0.0 tok/s','500.0 ms'],
    [{usage:{output:'90'}},'60.0 tok/s','500.0 ms'],
    [{usage:{output:null,reasoning:'0'}},'—','500.0 ms'],
    [{elapsed_us:null},'—','500.0 ms'],
    [{elapsed_us:'500000'},'—','500.0 ms'],
    [{elapsed_us:'490000'},'—','500.0 ms'],
    [{first_token_us:null},'—','—'],
  ]) {
    const speed=composerSpeed({responses:'1',observations:{recent:[{attempts:[{...attempt,...changes}]}]}});
    assert.equal(speed.value,'—');
    assert.deepEqual(detailValues(speed),['—',tps,ttft]);
  }
});

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

test('partial own tokens show subtotal and coverage without a cache rate',()=>{
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
