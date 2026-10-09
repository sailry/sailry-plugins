import test from 'node:test';
import assert from 'node:assert/strict';
import {run,write} from '../dev.sailry.platform/host/main.js';

test('description preserves command and optional metadata', () => {
  const command = "printf '%s' 'quoted\ncontent'";
  const description = 'Check the project configuration';
  assert.deepEqual(run({command,description}),
    {command,description,cwd:'',timeout_ms:120000,background:false,pty:false,attachments:[],access:'workspace'});
  assert.equal(run({command}).description,null);
  assert.equal(run({command,description:null}).description,null);
  assert.equal(run({command,description:'🙂'.repeat(2000)}).isError,undefined);
  for (const description of ['', ' \n ', 7, 'a\0b', '🙂'.repeat(2001)]) {
    assert.equal(run({command,description}).isError,true);
  }
});

test('PTY requires a background command', () => {
  assert.equal(run({command:'cat',background:true,pty:true}).pty,true);
  assert.equal(run({command:'true'}).pty,false);
  for (const args of [{pty:true},{pty:'yes',background:true}])
    assert.equal(run({command:'cat',...args}).isError,true);
});

test('input preserves bytes and validates its bound', () => {
  const input = 'answer\n🙂\u001b[A';
  assert.deepEqual(write({id:'command',input}),{id:'command',input});
  assert.equal(write({id:'command',input:'🙂'.repeat(16384)}).isError,undefined);
  for (const args of [{input:'yes'}, {id:'',input:'yes'}, {id:'command',input:4},
      {id:'command',input:'🙂'.repeat(16385)}, {id:'command',input:'yes',session:'other'}])
    assert.equal(write(args).isError,true);
});

 test('access defaults to confinement and validates explicit escape', () => {
  assert.equal(run({command:'true'}).access, 'workspace');
  assert.equal(run({command:'true',access:'unrestricted'}).access, 'unrestricted');
  for (const access of [null, '', true, 'full', {}, []])
    assert.equal(run({command:'true',access}).isError, true);
});
