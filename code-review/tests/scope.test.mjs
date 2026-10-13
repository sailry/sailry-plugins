import assert from 'node:assert/strict';
import test from 'node:test';
import {file,fixture,receipt} from './support.mjs';

const skipped = ['.env','.npmrc','.netrc','.pypirc','.ssh/id_rsa','credentials/token.json','secrets/api.json',
  'cert/server.key','node_modules/lib/main.js','target/debug/app.rs','generated/types.ts','src/schema.pb.go',
  'assets/app.min.js','Cargo.lock'];

test('inventory finishes before eligible reads', async () => {
  const source = Array.from({length:15},(_,index) => file(`src/file-${index}.rs`));
  const fixtureData = await fixture([...source,...skipped.map(path => file(path)),
    ...Array.from({length:550},(_,index) => file(`node_modules/pkg-${index}/index.js`))]);
  const scope = await fixtureData.invoke('scope',{});
  assert.equal(scope.counts.files,15);
  assert.equal(scope.counts.skipped,skipped.length+550);
  assert.equal(scope.groups.length,1);
  assert.equal(scope.groups[0].files.length,15);
  const first = fixtureData.calls.findIndex(call => call.kind === 'read_git_change');
  assert.equal(first,3);
  assert.ok(fixtureData.calls.slice(0,first).every(call => call.kind === 'list_git_changes'));
  const reads = fixtureData.calls.filter(call => call.kind === 'read_git_change').map(call => call.data.path);
  assert.deepEqual(new Set(reads),new Set(source.map(file => file.path)));
  const visible = [...scope.skipped];
  let next = scope.next;
  while (next !== null) {
    const page = await fixtureData.invoke('scope',{review_id:scope.review_id,offset:next,limit:100});
    visible.push(...page.skipped);
    next = page.next;
  }
  assert.equal(visible.length,scope.counts.skipped);
  assert.ok(visible.some(item => item.path === '.npmrc' && item.reason === 'credentials'));
});

test('patch reads distinguish inventory and file revisions', async () => {
  const fixtureData = await fixture([file('inventory/stock.py'),file('tests/test_stock.py')]);
  const scope = await fixtureData.invoke('scope',{});
  const git = await fixtureData.module('git');
  const selected = scope.files[0];
  assert.notEqual(scope.snapshot.metadata_revision,selected.metadata_revision);
  await assert.rejects(git.change(fixtureData.captured.worktree,scope.snapshot,
    {...selected,metadata_revision:scope.snapshot.metadata_revision}), {code:'revision_conflict'});
  for (const file of scope.files) {
    const page = await git.change(fixtureData.captured.worktree,scope.snapshot,file);
    assert.deepEqual(JSON.parse(JSON.stringify(page.snapshot)),scope.snapshot);
    assert.equal(page.metadata_revision,file.metadata_revision);
    assert.equal(page.revision,file.revision);
  }
  const reads = fixtureData.calls.filter(call => call.kind === 'read_git_change').slice(-scope.files.length);
  assert.deepEqual(reads.map(call => call.data),scope.files.map(file => ({
    worktree:fixtureData.captured.worktree,snapshot:scope.snapshot,path:file.path,
    expected_metadata_revision:file.metadata_revision,expected_revision:file.revision,offset:0,limit:500,
  })));
});

test('tests stay eligible and related files share groups', async () => {
  const fixtureData = await fixture(['src/math.c','include/math.h','tests/math_test.c',
    'other/src/main.rs','other/tests/main_test.rs','locales/en.json','locales/zh.json',
    'pkg-one/src/main.js','pkg-two/src/main.js','resources/en/messages.properties','resources/fr/messages.properties'].map(path => file(path)));
  const scope = await fixtureData.invoke('scope',{});
  assert.equal(scope.counts.files,11);
  const group = path => scope.files.find(file => file.path === path).group;
  assert.equal(group('src/math.c'),group('tests/math_test.c'));
  assert.equal(group('src/math.c'),group('include/math.h'));
  assert.equal(group('other/src/main.rs'),group('other/tests/main_test.rs'));
  assert.equal(group('locales/en.json'),group('locales/zh.json'));
  assert.notEqual(group('pkg-one/src/main.js'),group('pkg-two/src/main.js'));
  assert.equal(group('resources/en/messages.properties'),group('resources/fr/messages.properties'));
});

test('rules use order case and Objective-C prefixes', async () => {
  const fixtureData = await fixture([file('Cargo.TOML'),file('.github/workflows/build.yml'),file('src/unknown.xyz'),
    file('src/object.M',{first_line:'  #import <Foundation/Foundation.h>'}),file('src/value.m',{first_line:'function value = example()'})]);
  const scope = await fixtureData.invoke('scope',{});
  const rule = path => scope.files.find(file => file.path === path).rule;
  assert.equal(rule('Cargo.TOML').file,'cargo_toml.md');
  assert.equal(rule('.github/workflows/build.yml').file,'github_workflows.md');
  assert.equal(rule('src/unknown.xyz').file,'default.md');
  assert.equal(rule('src/object.M').file,'objc.md');
  assert.equal(rule('src/value.m').file,'matlab.md');
  for (const file of scope.files) assert.match(file.rule.sha256,/^[0-9a-f]{64}$/);
});

test('binary and unsupported files return skip receipts', async () => {
  const fixtureData = await fixture([file('src/image.bin',{binary:true}),file('src/socket',{skip_reason:'unsupported_mode'}),file('tests/main.rs')]);
  const scope = await fixtureData.invoke('scope',{});
  assert.equal(scope.counts.files,1);
  assert.deepEqual(scope.skipped.map(file => file.reason),['binary file','unsupported_mode']);
  assert.equal((await fixtureData.invoke('complete',receipt(scope))).status,'complete');
});

test('incomplete inventory and oversized scope never persist', async () => {
  for (const fixtureData of [await fixture([file('src/main.rs')],{incomplete:true}),
    await fixture(Array.from({length:257},(_,index) => file(`src/${index}.rs`)))]) {
    const result = await fixtureData.invoke('scope',{});
    assert.equal(result.isError,true);
    assert.equal(fixtureData.values.size,0);
    assert.equal(fixtureData.calls.filter(call => call.kind === 'read_git_change').length,0);
  }
});

test('creation failure preserves original flow outcome', async () => {
  const fixtureData = await fixture();
  const pending = await fixtureData.start('scope',{});
  const error = {isError:true,error:{code:'permission_denied',message:'Declined'}};
  assert.deepEqual(await fixtureData.finish(pending,error),error);
  assert.equal(fixtureData.values.size,0);
});


test('source test conventions retain project ownership', async () => {
  const fixtureData = await fixture(['java/src/main/java/example/Service.java',
    'java/src/test/java/example/ServiceTest.java','dotnet/src/Service.cs','dotnet/tests/ServiceTests.cs'].map(path => file(path)));
  const scope = await fixtureData.invoke('scope',{});
  const group = path => scope.files.find(file => file.path === path).group;
  assert.equal(group('java/src/main/java/example/Service.java'),group('java/src/test/java/example/ServiceTest.java'));
  assert.equal(group('dotnet/src/Service.cs'),group('dotnet/tests/ServiceTests.cs'));
  assert.notEqual(group('dotnet/src/Service.cs'),group('java/src/main/java/example/Service.java'));
});

test('oversized Unicode groups never persist', async () => {
  const source = Array.from({length:100},(_,index) => file(`src/${index}-${'漢'.repeat(700)}.rs`));
  const fixtureData = await fixture(source);
  const scope = await fixtureData.invoke('scope',{});
  assert.equal(scope.isError,true);
  assert.equal(fixtureData.values.size,0);
});


test('encoded scope pages continue without losing files', async () => {
  const source = Array.from({length:100},(_,index) => file(`part-${index}/${'漢'.repeat(700)}.rs`));
  const fixtureData = await fixture(source);
  const scope = await fixtureData.invoke('scope',{});
  assert.equal(scope.counts.files,100);
  assert.ok(Buffer.byteLength(JSON.stringify(scope)) <= 128*1024);
  assert.ok(scope.next !== null);
  const paths = scope.files.map(file => file.path);
  let next = scope.next;
  while (next !== null) {
    const page = await fixtureData.invoke('scope',{review_id:scope.review_id,offset:next});
    assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 128*1024);
    paths.push(...page.files.map(file => file.path));
    next = page.next;
  }
  assert.deepEqual(new Set(paths),new Set(source.map(file => file.path)));
});
