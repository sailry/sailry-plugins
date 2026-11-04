import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
const manifest = JSON.parse(fs.readFileSync(new URL('../plugin.json',import.meta.url),'utf8'));
const extension = manifest.extensions['dev.sailry.platform'];

test('preserves package identity and enable binding',() => {
  assert.equal(manifest.name,'code');
  assert.equal(manifest.version,'0.1.12');
  assert.equal(extension.api_version,'v1');
  assert.equal(extension.scope,'host');
  assert.equal(extension.enabled_service,'code_index');
  assert.equal(extension.settings_page,undefined);
  assert.equal(extension.settings_schema,undefined);
  assert.equal(extension.desktop,undefined);
  assert.equal(extension.display.locales['zh-CN'],'代码索引');
});

test('declares only bounded structure tools',() => {
  assert.deepEqual(extension.actions,['code.index.read','files.read']);
  assert.deepEqual(extension.tools.map(tool => tool.name),['code_search','code_outline','code_context']);
  assert.deepEqual(extension.tools.slice(0,2).map(tool => tool.operation),['code.search','code.outline']);
  const handler = extension.tools[2].handler;
  assert.equal(handler.read_only,true);
  assert.deepEqual(handler.flow.operations,['code.search','files.read_lines']);
  assert.equal(handler.parameters.properties.limit.maximum,20);
  assert.equal(handler.parameters.properties.max_snippets.maximum,5);
  assert.equal(handler.parameters.properties.max_bytes.maximum,16384);
  assert.deepEqual(extension.host.handlers,['context']);
  assert.deepEqual(extension.host.read_only,['context']);
  for (const tool of extension.tools) {
    assert.deepEqual(tool.contexts,['plugin','workspace']);
    assert.equal(tool.presentation,'summary');
    assert.equal(Object.keys(tool.display.locales).length,10);
  }
});

test('states when to use each tool',() => {
  assert.match(extension.instructions,/not usages, strings, comments or types/);
  assert.match(extension.instructions,/use search_files for text/);
  assert.match(extension.instructions,/1-based and inclusive/);
  assert.match(extension.instructions,/fresh search instead of reusing old ranges/);
  assert.doesNotMatch(extension.instructions,/code_diagnostics|code_install|code_start|not_installed/);
  const descriptions = Object.fromEntries(extension.tools.map(tool => [tool.name,tool.description]));
  assert.match(descriptions.code_search,/where functions, types, methods, constants or modules are defined/);
  assert.match(descriptions.code_search,/use search_files for those/);
  assert.match(descriptions.code_context,/source in one call/);
  assert.match(descriptions.code_outline,/Use before reading a large file/);
});
