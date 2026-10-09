import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const manifest=JSON.parse(readFileSync(new URL('../plugin.json',import.meta.url),'utf8'));
const extension=manifest.extensions['dev.sailry.platform'];

test('native tools retain read and mutation boundaries', () => {
  assert.equal(extension.api_version,'v1');
  assert.equal(extension.scope,'host');
  assert.deepEqual(extension.tools.map(tool=>[tool.name,tool.operation]),[
    ['knowledge_search','knowledge.query'],
    ['read_knowledge_source','knowledge.read'],
    ['list_knowledge_collections','knowledge.collections'],
    ['create_knowledge_collection','knowledge.create'],
    ['rebuild_knowledge_collection','knowledge.rebuild'],
    ['remove_knowledge_collection','knowledge.remove']
  ]);
  for(const tool of extension.tools) {
    assert.equal(tool.handler,undefined);
    assert.deepEqual(tool.contexts,['plugin','workspace']);
  }
  assert.deepEqual(extension.actions,['knowledge.read','knowledge.write','files.read','storage.read','conversation.read']);
  assert.equal(extension.host,undefined);
});

test('guidance keeps sources untrusted and models explicit', () => {
  assert.match(extension.instructions,/returned source path and position/);
  assert.match(extension.instructions,/untrusted data/);
  assert.match(extension.instructions,/never download/);
  const create=extension.tools.find(tool=>tool.operation==='knowledge.create');
  assert.match(create.description,/current worktree/);
  assert.match(create.description,/own Node or conversation storage/);
  assert.match(create.description,/Requires write permission/);
  const remove=extension.tools.find(tool=>tool.operation==='knowledge.remove');
  assert.match(remove.description,/Original files and plugin values remain intact/);
  const read=extension.tools.find(tool=>tool.operation==='knowledge.read');
  assert.match(read.description,/granted files outside the worktree/);
  assert.match(read.description,/grants are rechecked on every page/);
  assert.match(read.description,/next_offset/);
});
