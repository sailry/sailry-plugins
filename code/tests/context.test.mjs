import assert from 'node:assert/strict';
import test from 'node:test';
import {context} from '../dev.sailry.platform/host/context.js';

const revision = 'a'.repeat(64);
const symbol = (path='src/main.rs',start=0,end=1) => ({path,language:'rust',name:'entry',kind:'function',
  range:{start_byte:start*10,end_byte:end*10,start_line:start,start_column:0,end_line:end,end_column:1},
  signature:'fn entry()',file_revision:revision,depth:0});
const page = symbols => ({symbols,index_revision:7,partial:false,truncated:false,visited:1,skipped:0,issues:[]});
function search(symbols,input={}) {
  const start = context({arguments:input,step:0});
  assert.equal(start.call.operation,'code.search');
  return context({step:1,state:start.state,outcome:{kind:'code_search',data:page(symbols)}});
}
function reply(pending,text='fn entry() {}\n',count=1) {
  const query = pending.call.arguments;
  return {kind:'file_lines',data:{path:query.path,revision:query.expected_revision,offset:query.offset,
    size:Buffer.byteLength(text)*count,next_offset:null,
    lines:Array.from({length:count},(_,index) => ({number:query.offset+index+1,text}))}};
}

test('merges overlapping ranges before expansion',() => {
  const pending = search([symbol('main.rs',2,4),symbol('main.rs',3,6),symbol('main.rs',2,4)]);
  assert.deepEqual(pending.call,{operation:'files.read_lines',arguments:{path:'main.rs',offset:0,limit:9,expected_revision:revision}});
  const completed = context({step:2,state:pending.state,outcome:reply(pending,'line\r\n',9)});
  assert.equal(completed.result.symbols.length,3);
  assert.equal(completed.result.snippets.length,1);
  assert.equal(completed.result.snippets[0].start_line,1);
  assert.equal(completed.result.snippets[0].end_line,9);
  assert.equal(completed.result.snippets[0].text,'line\r\n'.repeat(9));
  assert.equal(completed.result.snippets[0].file_revision,revision);
  assert.equal(completed.result.index_revision,7);
  assert.equal(completed.result.partial,false);
});

test('reports pagination before the requested range ends',() => {
  const pending = search([symbol('main.rs',10,11)]);
  const outcome = reply(pending,'first line\n');
  outcome.data.next_offset = pending.call.arguments.offset+1;
  const completed = context({step:2,state:pending.state,outcome});
  assert.equal(completed.call,undefined);
  assert.equal(completed.result.partial,true);
  assert.equal(completed.result.truncated,true);
  assert.equal(completed.result.snippets.length,1);
  assert.equal(completed.result.snippets[0].truncated,true);
  assert.equal(completed.result.snippets[0].text,'first line\n');
  assert.ok(Buffer.byteLength(JSON.stringify(completed.result)) < 16384);
});

test('keeps complete ranges with later file pages',() => {
  const pending = search([symbol('main.rs',10,11)]);
  const query = pending.call.arguments;
  const outcome = reply(pending,'line\n',query.limit);
  outcome.data.next_offset = query.offset+query.limit;
  const completed = context({step:2,state:pending.state,outcome});
  assert.equal(completed.call,undefined);
  assert.equal(completed.result.partial,false);
  assert.equal(completed.result.truncated,false);
  assert.equal(completed.result.snippets[0].truncated,false);
  assert.equal(completed.result.snippets[0].end_line,query.offset+query.limit);
  assert.equal(completed.result.snippets[0].text,'line\n'.repeat(query.limit));
});

test('caps symbols snippets and operation count',() => {
  let pending = search(Array.from({length:30},(_,index) => symbol(`file${index}.rs`)));
  let step = 2, reads = 0;
  while (pending.call) {
    assert.equal(pending.call.operation,'files.read_lines');
    reads++;
    pending = context({step:step++,state:pending.state,outcome:reply(pending)});
  }
  assert.equal(reads,5);
  assert.equal(pending.result.symbols.length,20);
  assert.equal(pending.result.snippets.length,5);
  assert.equal(pending.result.partial,true);
  assert.equal(pending.result.truncated,true);
  assert.ok(Buffer.byteLength(JSON.stringify(pending.result)) <= 16384);
});

test('bounds escaped multibyte output by bytes',() => {
  const pending = search([symbol()],{max_bytes:1024});
  const result = context({step:2,state:pending.state,outcome:reply(pending,'中文🙂"\\\t'.repeat(1000))}).result;
  assert.equal(result.partial,true);
  assert.equal(result.truncated,true);
  assert.ok(result.snippets[0].text.length > 0);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 1024);
  assert.equal(result.snippets[0].text.includes('\ufffd'),false);
  assert.equal(result.snippets[0].truncated,true);
});

test('bounds metadata before requesting source',() => {
  const large = {...symbol(),name:'字'.repeat(10000)};
  const completed = search([large],{max_bytes:512});
  assert.equal(completed.call,undefined);
  assert.deepEqual(completed.result.symbols,[]);
  assert.deepEqual(completed.result.snippets,[]);
  assert.equal(completed.result.truncated,true);
  assert.ok(Buffer.byteLength(JSON.stringify(completed.result)) <= 512);
});

test('returns revision conflicts without stale expansion',() => {
  const pending = search([symbol()]);
  const outcome = {isError:true,error:{code:'revision_conflict',message:'File changed'}};
  assert.deepEqual(context({step:2,state:pending.state,outcome}),{result:outcome});
});

test('stops remaining reads after a later conflict',() => {
  const first = search([symbol('first.rs'),symbol('changed.rs'),symbol('remaining.rs')]);
  const second = context({step:2,state:first.state,outcome:reply(first)});
  assert.equal(second.call.arguments.path,'changed.rs');
  assert.equal(second.state.data.snippets.length,1);
  const outcome = {isError:true,error:{code:'revision_conflict',message:'File changed'}};
  const completed = context({step:3,state:second.state,outcome});
  assert.deepEqual(completed,{result:outcome});
  assert.equal(completed.call,undefined);
});

test('rejects a mismatched successful source revision',() => {
  const pending = search([symbol()]);
  const outcome = reply(pending);
  outcome.data.revision = 'b'.repeat(64);
  const completed = context({step:2,state:pending.state,outcome});
  assert.equal(completed.result.isError,true);
  assert.deepEqual(completed.result.error,{code:'invalid_request',message:'Invalid revision-checked source result'});
});

test('clips long declarations and reports incomplete context',() => {
  const pending = search([symbol('large.rs',1,1000)]);
  assert.equal(pending.call.arguments.limit,80);
  const result = context({step:2,state:pending.state,outcome:reply(pending,'line\n',80)}).result;
  assert.equal(result.partial,true);
  assert.equal(result.truncated,true);
  assert.equal(result.snippets[0].truncated,true);
  assert.equal(result.snippets[0].end_line,80);
});

test('preserves incomplete search metadata',() => {
  const start = context({arguments:{name:'entry',path:'src/',language:'rust',limit:3},step:0});
  assert.deepEqual(start.call.arguments,{name:'entry',path:'src/',language:'rust',limit:3});
  const data = {...page([]),partial:true,skipped:1,issues:[{path:'vendor.sql',status:'unsupported'}]};
  const completed = context({step:1,state:start.state,outcome:{kind:'code_search',data}});
  assert.equal(completed.result.partial,true);
  assert.deepEqual(completed.result.issues,data.issues);
  assert.equal(completed.result.skipped,1);
});

test('rejects invalid limits and continuations',() => {
  for (const input of [{limit:21},{max_snippets:6},{max_bytes:16385},{max_bytes:100},{query:3}]) {
    assert.equal(context({arguments:input,step:0}).result.isError,true);
  }
  assert.equal(context({step:7}).result.isError,true);
});
