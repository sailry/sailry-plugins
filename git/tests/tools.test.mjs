import test from 'node:test';
import assert from 'node:assert/strict';
import {status,diff,log,show,blame,changes,change} from '../dev.sailry.platform/host/main.js';

test('history preserves first-page defaults and exact continuation', () => {
  assert.deepEqual(log({}),{worktree:null,limit:20,cursor:null});
  assert.deepEqual(log({limit:5,cursor:null}),{worktree:null,limit:5,cursor:null});
  const cursor = {head:'a'.repeat(40),offset:5};
  assert.deepEqual(log({cursor,worktree:'captured-project-tree'}),
    {worktree:'captured-project-tree',limit:20,cursor});
  for (const cursor of ['HEAD',{head:'abcdef',offset:5},{head:'a'.repeat(40),offset:-1}]) {
    assert.equal(log({cursor}).isError,true);
  }
});

test('status and diff preserve explicit registered target and scope', () => {
  assert.deepEqual(status({}),{worktree:null});
  assert.deepEqual(status({worktree:'tree'}),{worktree:'tree'});
  assert.deepEqual(diff({path:'src/资料.rs'}),{worktree:null,path:'src/资料.rs',scope:'all'});
  assert.deepEqual(diff({path:'file',scope:'staged',worktree:'tree'}),
    {worktree:'tree',path:'file',scope:'staged'});
  for (const args of [{path:'file',scope:'both'},{path:'file',scope:null},{path:8}]) {
    assert.equal(diff(args).isError,true);
  }
});

test('arguments cannot inject project or execution commands', () => {
  assert.equal(status({project:'other'}).isError,true);
  assert.equal(diff({path:'file',command:'checkout'}).isError,true);
  for (const args of [{limit:0},{limit:101},{limit:null},{worktree:7}]) {
    assert.equal(log(args).isError,true);
  }
});

test('show and blame preserve literal paths and immutable continuation', () => {
  assert.deepEqual(show({}), {worktree:null,revision:'HEAD',path:null,offset:0,limit:200});
  assert.deepEqual(show({path:'-quoted[1].rs',revision:'HEAD~1',offset:8,limit:2}),
    {worktree:null,revision:'HEAD~1',path:'-quoted[1].rs',offset:8,limit:2});
  assert.deepEqual(blame({path:'资料.rs'}),
    {worktree:null,revision:null,path:'资料.rs',offset:0,limit:200});
  for (const handler of [show,blame]) {
    for (const args of [{path:'file',offset:-1},{path:'file',limit:501},
      {path:'file',offset:Number.MAX_SAFE_INTEGER},{path:'file',project:'outside'},
      {path:'file',revision:3},{path:2}]) {
      assert.equal(handler(args).isError,true);
    }
  }
  assert.equal(show({offset:1}).isError,true);
  assert.equal(blame({}).isError,true);
});

test('change inventory keeps frozen cursors and explicit target alternatives', () => {
  const target = {kind:'worktree',data:{scope:'all'}};
  assert.deepEqual(changes({}), {worktree:null,target,cursor:null,limit:200});
  const snapshot = {target:{kind:'commit',data:{revision:'a'.repeat(40),parent:null}},metadata_revision:'b'.repeat(64)};
  for (const after_path of [null,'src/file.rs']) {
    const cursor = {snapshot,after_path};
    assert.deepEqual(changes({cursor}), {worktree:null,target:null,cursor,limit:200});
    assert.equal(changes({target,cursor}).isError,true);
  }
  for (const args of [{target:null},{limit:0},{limit:501},{project:'outside'},{cursor:{snapshot,after_path:3}}]) {
    assert.equal(changes(args).isError,true);
  }
});

test('mapped changes require strong revision on continuation', () => {
  const snapshot = {target:{kind:'range',data:{base:'a'.repeat(40),head:'b'.repeat(40)}},metadata_revision:'c'.repeat(64)};
  const initial = {snapshot,path:'-file[1].rs',expected_metadata_revision:'d'.repeat(64)};
  assert.deepEqual(change(initial), {...initial,worktree:null,expected_revision:null,offset:0,limit:200});
  assert.equal(change({...initial,offset:1}).isError,true);
  assert.deepEqual(change({...initial,expected_revision:'e'.repeat(64),offset:10}),
    {...initial,worktree:null,expected_revision:'e'.repeat(64),offset:10,limit:200});
  for (const args of [{...initial,limit:501},{...initial,command:'checkout'},{...initial,offset:-1}]) {
    assert.equal(change(args).isError,true);
  }
});
