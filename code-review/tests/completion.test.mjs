import assert from 'node:assert/strict';
import test from 'node:test';
import {file,fixture,receipt,finding,uuid} from './support.mjs';

function partial(scope, group) {
  return receipt(scope,{reviewed_groups:[group.id],reviewed_files:scope.files.filter(file => group.files.includes(file.path))
    .map(({path,revision}) => ({path,revision})),finalize:false});
}

test('zero findings still require every file and group', async () => {
  const fixtureData = await fixture(Array.from({length:15},(_,index) => file(`src/${index}.rs`)));
  const scope = await fixtureData.invoke('scope',{});
  const missing = await fixtureData.invoke('complete',receipt(scope,{reviewed_files:[],reviewed_groups:[]}));
  assert.equal(missing.isError,true);
  assert.equal(missing.remaining.counts.files,15);
  assert.deepEqual(missing.remaining.groups,[scope.groups[0].id]);
  const result = await fixtureData.invoke('complete',receipt(scope));
  assert.equal(result.status,'complete');
  assert.equal(result.reviewed_files,15);
  assert.equal(result.findings,0);
  assert.equal(result.remaining.counts.files,0);
});

test('invalid duplicate and partial receipts are rejected', async () => {
  const fixtureData = await fixture([file('src/a.rs'),file('src/b.rs')]);
  const scope = await fixtureData.invoke('scope',{});
  const complete = receipt(scope);
  for (const invalid of [{reviewed_files:complete.reviewed_files.slice(0,1)},
    {reviewed_files:[...complete.reviewed_files,complete.reviewed_files[0]]},
    {reviewed_groups:[...complete.reviewed_groups,complete.reviewed_groups[0]]},
    {reviewed_groups:['group-unknown']},{reviewed_files:[{path:'outside.rs',revision:'anything'}]},
    {reviewed_files:complete.reviewed_files.map(file => ({...file,revision:'stale'}))}]) {
    assert.equal((await fixtureData.invoke('complete',{...complete,...invalid})).isError,true);
  }
  const head = fixtureData.values.get(`review/${scope.review_id}/head`).value;
  assert.equal(head.status,'open');
  assert.deepEqual(head.reviewed_groups,[]);
});

test('strong changes invalidate finalization despite stable metadata', async () => {
  const fixtureData = await fixture();
  const scope = await fixtureData.invoke('scope',{});
  fixtureData.change(scope.files[0].path,{revision:'external edit with restored metadata'});
  const result = await fixtureData.invoke('complete',receipt(scope));
  assert.equal(result.error.code,'revision_conflict');
  assert.equal(fixtureData.values.get(`review/${scope.review_id}/head`).value.status,'open');
});

test('frozen inventory rejects new working paths', async () => {
  const fixtureData = await fixture();
  const scope = await fixtureData.invoke('scope',{});
  fixtureData.metadata('inventory:changed');
  const result = await fixtureData.invoke('complete',receipt(scope));
  assert.equal(result.error.code,'revision_conflict');
  assert.equal(fixtureData.values.get(`review/${scope.review_id}/head`).value.status,'open');
});

test('commit finalization never resolves moving refs again', async () => {
  const fixtureData = await fixture();
  const scope = await fixtureData.invoke('scope',{target:{kind:'commit',data:{revision:'HEAD'}}});
  fixtureData.head('b'.repeat(40));
  fixtureData.change(scope.files[0].path,{revision:'working copy changed'});
  fixtureData.metadata('inventory:changed');
  const result = await fixtureData.invoke('complete',receipt(scope));
  assert.equal(result.status,'complete');
  const pages = fixtureData.calls.filter(call => call.kind === 'list_git_changes');
  assert.equal(pages[1].data.target,null);
  assert.deepEqual(pages[1].data.cursor,{snapshot:scope.snapshot,after_path:null});
});

test('children cover groups and creator finalizes the union', async () => {
  const fixtureData = await fixture([file('first/main.rs'),file('second/main.rs')]);
  const creator = fixtureData.captured.session;
  const scope = await fixtureData.invoke('scope',{});
  fixtureData.actor(uuid(20),creator);
  const first = await fixtureData.invoke('complete',partial(scope,scope.groups[0]));
  assert.equal(first.status,'open');
  assert.equal(first.reviewed_files,1);
  assert.equal(first.remaining.counts.files,1);
  assert.equal((await fixtureData.invoke('complete',receipt(scope,{reviewed_files:[],reviewed_groups:[],finalize:true}))).error.code,'permission_denied');
  fixtureData.actor(uuid(21),creator);
  assert.equal((await fixtureData.invoke('complete',partial(scope,scope.groups[1]))).status,'open');
  fixtureData.actor(creator);
  const final = await fixtureData.invoke('complete',receipt(scope,{reviewed_files:[],reviewed_groups:[]}));
  assert.equal(final.status,'complete');
  assert.equal(final.reviewed_files,2);
  assert.equal(fixtureData.values.get(`review/${scope.review_id}/head`).value.receipts.length,2);
  assert.equal((await fixtureData.invoke('finding',finding(scope))).error.code,'conflict');
});

test('unrelated sessions grandchildren and package drift cannot write', async () => {
  const fixtureData = await fixture();
  const creator = fixtureData.captured.session;
  const scope = await fixtureData.invoke('scope',{});
  for (const [id,parent,worktree] of [[uuid(20),null,fixtureData.captured.worktree],
    [uuid(21),uuid(20),null],[uuid(22),creator,uuid(99)]]) {
    fixtureData.actor(id,parent,worktree ?? fixtureData.captured.worktree);
    const result = await fixtureData.invoke('finding',finding(scope));
    assert.equal(result.error.code,'permission_denied');
  }
  fixtureData.actor(creator);
  fixtureData.captured.package.settings_revision = '1';
  assert.equal((await fixtureData.invoke('complete',receipt(scope))).error.code,'permission_denied');
});

test('CAS conflicts keep parallel findings without hidden retry', async () => {
  const fixtureData = await fixture();
  const creator = fixtureData.captured.session;
  const scope = await fixtureData.invoke('scope',{});
  fixtureData.actor(uuid(20),creator);
  const first = await fixtureData.start('finding',finding(scope));
  fixtureData.actor(uuid(21),creator);
  const second = await fixtureData.start('finding',finding(scope,{title:'Second evidenced finding'}));
  assert.equal(first.response.call.arguments.operations[0].data.expected_revision,'1');
  assert.equal(second.response.call.arguments.operations[0].data.expected_revision,'1');
  assert.ok((await fixtureData.finish(first)).finding);
  const reads = fixtureData.calls.length;
  assert.equal((await fixtureData.finish(second)).error.code,'revision_conflict');
  assert.equal(fixtureData.calls.length,reads);
  assert.ok((await fixtureData.invoke('finding',finding(scope,{title:'Second evidenced finding'}))).finding);
  assert.equal(fixtureData.values.get(`review/${scope.review_id}/head`).value.findings.length,2);
});

test('CAS protects receipts from concurrent lost updates', async () => {
  const fixtureData = await fixture([file('first/main.rs'),file('second/main.rs')]);
  const creator = fixtureData.captured.session;
  const scope = await fixtureData.invoke('scope',{});
  fixtureData.actor(uuid(20),creator);
  const first = await fixtureData.start('complete',partial(scope,scope.groups[0]));
  fixtureData.actor(uuid(21),creator);
  const second = await fixtureData.start('complete',partial(scope,scope.groups[1]));
  assert.equal((await fixtureData.finish(first)).status,'open');
  assert.equal((await fixtureData.finish(second)).error.code,'revision_conflict');
  assert.equal((await fixtureData.invoke('complete',partial(scope,scope.groups[1]))).status,'open');
  fixtureData.actor(creator);
  const result = await fixtureData.invoke('complete',receipt(scope,{reviewed_files:[],reviewed_groups:[]}));
  assert.equal(result.status,'complete');
  assert.equal(result.reviewed_files,2);
});

test('finalization races reject stale reports', async () => {
  const fixtureData = await fixture();
  const scope = await fixtureData.invoke('scope',{});
  const report = await fixtureData.start('finding',finding(scope));
  assert.equal((await fixtureData.invoke('complete',receipt(scope))).status,'complete');
  assert.equal((await fixtureData.finish(report)).error.code,'revision_conflict');
  const head = fixtureData.values.get(`review/${scope.review_id}/head`).value;
  assert.deepEqual(head.findings,[]);
});
