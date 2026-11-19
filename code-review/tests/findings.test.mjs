import assert from 'node:assert/strict';
import test from 'node:test';
import {file,fixture,finding} from './support.mjs';

const lines = [{kind:'context',old_line:2,new_line:2,text:'if (ready) {'},
  {kind:'deleted',old_line:3,new_line:null,text:'return original();'},
  {kind:'added',old_line:null,new_line:3,text:'return changed();'},
  {kind:'context',old_line:4,new_line:4,text:'}'}];

function item(scope, overrides = {}) {
  const {review_id,snippet,...args} = finding(scope);
  return {...args,...overrides};
}

test('unique snippets correct suggested line numbers', async () => {
  const fixtureData = await fixture([file('src/main.js',{lines})]);
  const scope = await fixtureData.invoke('scope',{});
  const result = await fixtureData.invoke('finding',finding(scope,{line:999,snippet:'if (ready) {\nreturn changed();\n'}));
  assert.equal(result.finding.line,3);
  assert.equal(result.finding.side,'new');
  assert.equal(result.finding.revision,scope.files[0].revision);
  assert.equal(result.finding.reporter,fixtureData.captured.session);
});

test('deleted lines use old-side locations', async () => {
  const fixtureData = await fixture([file('src/main.js',{lines})]);
  const scope = await fixtureData.invoke('scope',{});
  const result = await fixtureData.invoke('finding',finding(scope,{side:'old',snippet:'return original();',line:55}));
  assert.equal(result.finding.line,3);
  assert.equal(result.finding.side,'old');
  assert.equal((await fixtureData.invoke('finding',finding(scope,{side:'new',snippet:'return original();'}))).isError,true);
});

test('absent ambiguous and context-only anchors fail', async () => {
  const duplicate = [...lines,{kind:'added',old_line:null,new_line:10,text:'return changed();'}];
  const fixtureData = await fixture([file('src/main.js',{lines:duplicate})]);
  const scope = await fixtureData.invoke('scope',{});
  const before=fixtureData.values.size;
  for (const snippet of ['missing();','return changed();','if (ready) {']) {
    const result = await fixtureData.invoke('finding',finding(scope,{snippet}));
    assert.equal(result.isError,true);
  }
  assert.equal(fixtureData.values.size,before);
});

test('scoped files revisions and evidence are mandatory', async () => {
  const fixtureData = await fixture();
  const scope = await fixtureData.invoke('scope',{});
  for (const change of [{path:'.env'},{revision:'stale'},{severity:'P4'},{evidence:' '},{unexpected:true}]) {
    const result = await fixtureData.invoke('finding',finding(scope,change));
    assert.equal(result.isError,true);
  }
  fixtureData.change(scope.files[0].path,{revision:'updated'});
  const result = await fixtureData.invoke('finding',finding(scope));
  assert.equal(result.finding.revision,scope.files[0].revision);
});

test('anchoring exhausts mapped pages under one strong revision', async () => {
  const many = Array.from({length:1100},(_,index) => ({kind:'added',old_line:null,new_line:index+1,text:`changed_${index}();`}));
  const fixtureData = await fixture([file('src/main.js',{lines:many})]);
  const scope = await fixtureData.invoke('scope',{});
  const result = await fixtureData.invoke('finding',finding(scope,{snippet:'changed_1099();',line:1}));
  assert.equal(result.finding.line,1100);
  const pages = fixtureData.calls.filter(call => call.kind === 'read_git_change');
  assert.deepEqual(pages.map(page => page.data.offset),[0,500,1000]);
  assert.ok(pages.slice(1).every(page => page.data.expected_revision === scope.files[0].revision));
});

test('line anchors use unique changed lines from frozen content', async () => {
  const fixtureData = await fixture([file('src/main.js',{lines:[...lines,
    {kind:'added',old_line:null,new_line:5,text:'same mapping'},
    {kind:'added',old_line:null,new_line:5,text:'ambiguous mapping'},
    {kind:'added',old_line:null,new_line:6,text:'only on the new side'}]})]);
  const scope = await fixtureData.capture();
  fixtureData.change(scope.files[0].path,{lines:[],revision:'updated'});
  const initialSize = fixtureData.values.size;
  for (const [side,line,error] of [['old',2,/does not anchor a changed line/],['new',5,/ambiguous/],
    ['old',6,/absent/],['new',99,/absent/]]) {
    const result = await fixtureData.invoke('finding',{review_id:scope.review_id,...item(scope,{side,line})});
    assert.equal(result.isError,true);
    assert.match(result.error.message,error);
  }
  assert.equal(fixtureData.values.size,initialSize);
  for (const side of ['old','new']) {
    const result = await fixtureData.invoke('finding',{review_id:scope.review_id,...item(scope,{side,line:3})});
    assert.equal(result.finding.line,3);
    assert.equal(result.finding.side,side);
    assert.equal(result.finding.revision,scope.files[0].revision);
    assert.equal(Object.hasOwn(result.finding,'snippet'),false);
  }
});

test('a mixed batch reads each diff once and writes valid findings', async () => {
  const fixtureData = await fixture([file('src/main.js',{lines})]);
  const scope = await fixtureData.capture();
  const reads = fixtureData.valueReads.length;
  const pending = await fixtureData.start('finding',{review_id:scope.review_id,findings:[
    item(scope,{line:3}),item(scope,{line:2}),item(scope,{revision:'stale'}),
    item(scope,{side:'old',line:999,snippet:'return original();'}),item(scope,{unexpected:true}),
  ]});
  assert.equal(fixtureData.valueReads.slice(reads).filter(key => key.includes('/data/')).length,1);
  const result = await fixtureData.finish(pending);
  assert.equal(result.review_id,scope.review_id);
  assert.equal(pending.attempts.length,1);
  assert.equal(pending.attempts[0].length,3);
  assert.deepEqual(result.results.map(entry => entry.error?.code ?? entry.line),
    [3,'invalid_request','revision_conflict',3,'invalid_request']);
  const base = `review/${scope.review_id}`;
  const ids = [result.results[0].id,result.results[3].id];
  assert.notEqual(ids[0],ids[1]);
  assert.deepEqual(fixtureData.values.get(`${base}/head`).value.findings,ids);
  assert.equal(fixtureData.values.get(`${base}/finding/${ids[1]}`).value.finding.snippet,'return original();');
  const stored = await fixtureData.invoke('scope',{review_id:scope.review_id});
  assert.deepEqual(stored.findings.map(finding => finding.id),ids);
});

test('a batch with no valid finding skips the transaction', async () => {
  const fixtureData = await fixture();
  const scope = await fixtureData.capture();
  const before = structuredClone([...fixtureData.values]);
  const pending = await fixtureData.start('finding',{review_id:scope.review_id,
    findings:[item(scope,{line:99}),item(scope,{title:''})]});
  const output = await fixtureData.finish(pending);
  assert.equal(pending.response.call,undefined);
  assert.deepEqual(output.results.map(entry => entry.isError),[true,true]);
  assert.deepEqual([...fixtureData.values],before);
});

test('a batch retains finding keys through a concurrent write', async () => {
  const fixtureData = await fixture();
  const scope = await fixtureData.capture();
  const single = await fixtureData.start('finding',finding(scope));
  const batch = await fixtureData.start('finding',{review_id:scope.review_id,findings:[item(scope),item(scope)]});
  const first = await fixtureData.finish(single);
  const {results} = await fixtureData.finish(batch);
  assert.equal(batch.attempts.length,2);
  const keys = operations => operations.slice(1).map(operation => operation.data.key);
  assert.deepEqual(keys(batch.attempts[0]),keys(batch.attempts[1]));
  assert.deepEqual(fixtureData.values.get(`review/${scope.review_id}/head`).value.findings,
    [first.finding.id,...results.map(entry => entry.id)]);
});
