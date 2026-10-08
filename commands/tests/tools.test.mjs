import test from 'node:test';
import assert from 'node:assert/strict';
import {run} from '../dev.sailry.platform/host/main.js';

test('description preserves command and optional metadata', () => {
  const command = "printf '%s' 'quoted\ncontent'";
  const description = 'Check the project configuration';
  assert.deepEqual(run({command,description}),
    {command,description,cwd:'',timeout_ms:120000,background:false,attachments:[]});
  assert.equal(run({command}).description,null);
  assert.equal(run({command,description:null}).description,null);
  assert.equal(run({command,description:'🙂'.repeat(2000)}).isError,undefined);
  for (const description of ['', ' \n ', 7, 'a\0b', '🙂'.repeat(2001)]) {
    assert.equal(run({command,description}).isError,true);
  }
});
