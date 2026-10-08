import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
const manifest = JSON.parse(fs.readFileSync(new URL('../plugin.json', import.meta.url), 'utf8'));
const extension = manifest.extensions['dev.sailry.platform'];
test('uses bounded native reads without shell or installation', () => {
  assert.equal(extension.api_version, 'v1');
  assert.deepEqual(extension.actions, ['code.read']);
  assert.deepEqual(extension.tools.map(tool => tool.operation), ['code.diagnostics','code.definition','code.references','code.hover','code.symbols']);
  for (const tool of extension.tools) {
    assert.deepEqual(tool.contexts, ['workspace']);
    assert.equal(tool.handler, undefined);
    assert.match(tool.description, /(?:file|symbol|symbols)/i);
    assert.ok(tool.display.label && tool.display.locales['zh-CN']);
  }
});
test('explains cold-start consent and incomplete results', () => {
  const instructions = extension.instructions;
  assert.match(instructions, /Ask-mode cold start requests approval/);
  assert.match(instructions, /does not install/);
  assert.match(instructions, /partial/);
  assert.match(instructions, /line numbers start at one/);
});
