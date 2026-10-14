import test from 'node:test';
import assert from 'node:assert/strict';
import {formatRows,when,hits,lateStart,longResponse,WARNING_ICON} from '../dev.sailry.platform/desktop/requests.js';

const text={composer_metric_unknown:'Unknown',usage_untitled:'Untitled',usage_unassigned:'Unassigned',
  usage_duration_ms:'%{value} ms',usage_duration_value:'%{value} s',usage_duration_us:'%{value} µs',
  usage_column_model:'Model',usage_column_provider:'Provider',usage_column_input:'Input',usage_column_cached:'Cached',
  usage_column_output:'Output',usage_column_reasoning:'Reasoning',usage_column_first_token:'First token',usage_column_duration:'Duration'};
const local=(year,month,day,hour=0,minute=0,second=0)=>new Date(year,month-1,day,hour,minute,second).getTime();
const request=(overrides={})=>({position:{node:'n',timestamp_ms:String(local(2026,10,14,9,5,7)),sequence:'3'},
  session_title:'Fix login',scope_name:'web',model:'gpt-5',provider_name:'OpenAI',
  tokens:{input:'1000',output:'18446744073709551615',cached_input:'300',reasoning:'5'},
  first_token_us:'10000001',elapsed_us:'15000000',usd_micros:'1234567',...overrides});

test('times show the date only outside today',()=>{
  const now=local(2026,10,14,18);
  assert.equal(when(String(local(2026,10,14,9,5,7)),now),'09:05:07');
  assert.equal(when(String(local(2026,10,13,23,59,59)),now),'10/13 23:59:59');
  assert.equal(when('not a time',now),null);
});

test('cache rates floor and cap cached input',()=>{
  assert.equal(hits({input:'3',cached_input:'2'}),66);
  assert.equal(hits({input:'2',cached_input:'7'}),100);
  assert.equal(hits({input:'0',cached_input:'0'}),null);
  assert.equal(hits(null),null);
});

test('slow thresholds are strict for first text and inclusive for duration',()=>{
  assert(!lateStart('10000000'));assert(lateStart('10000001'));assert(!lateStart(null));
  assert(!longResponse('14999999'));assert(longResponse('15000000'));assert(!longResponse(null));
});

test('rows mark slow and low-cache requests on one line',()=>{
  const {rows,cells,details,row_ids}=formatRows([request()],text,local(2026,10,14,18));
  assert.equal(rows[0].length,8);assert.equal(cells[0].length,8);
  assert.equal(rows[0][1],'Fix login · web');assert.equal(rows[0][2],'gpt-5 · OpenAI');
  assert.equal(rows[0][3],'1000 · 30%');assert.equal(rows[0][4],'18446744073709551615');
  assert.equal(rows[0][7],'1.234567');
  assert.match(details[0][4],/Reasoning: 5/);
  assert.deepEqual(cells[0][0],{primary:{text:'09:05:07',text_tone:'muted'}});
  assert.deepEqual(cells[0][1],{primary:{text:'Fix login',chip:'web'}});
  assert.deepEqual(cells[0][2],{primary:{text:'gpt-5',note:'OpenAI',badge:'O'}});
  assert.deepEqual(cells[0][3].primary.meter,{value:30,label:'30%',tone:'warning',icon:WARNING_ICON});
  assert.equal(cells[0][5].primary.text_tone,'warning');
  assert.equal(cells[0][6].primary.text_tone,'warning');
  assert.equal(cells[0][7].primary.text,'$1.2345');
  assert.ok(cells.flat().every(cell=>!('secondary' in cell)));
  assert.equal(row_ids[0],`n:${local(2026,10,14,9,5,7)}:3`);
  assert.doesNotThrow(()=>JSON.stringify({rows,cells,details,row_ids}));
});

test('rows keep missing values muted and healthy values neutral',()=>{
  const item=request({session_title:null,scope_name:null,first_token_us:null,elapsed_us:'2000',usd_micros:null,
    tokens:{input:'10',output:'1',cached_input:'5',reasoning:'0'}});
  const {rows,cells}=formatRows([item],text,local(2026,10,15));
  assert.equal(cells[0][0].primary.text,'10/14 09:05:07');
  assert.deepEqual(cells[0][1],{primary:{text:'Untitled',chip:'Unassigned',text_tone:'muted'}});
  assert.deepEqual(cells[0][3].primary.meter,{value:50,label:'50%',tone:'muted'});
  assert.deepEqual(cells[0][5],{primary:{text:'Unknown',text_tone:'muted'}});
  assert.deepEqual(cells[0][6],{primary:{text:'2.0 ms'}});
  assert.deepEqual(cells[0][7],{primary:{text:'Unknown',text_tone:'muted'}});
  assert.equal(rows[0][7],'Unknown');
  const bare=formatRows([request({tokens:null})],text).cells[0];
  assert.deepEqual(bare[3],{primary:{text:'Unknown'}});
});
