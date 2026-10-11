import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
const manifest = JSON.parse(fs.readFileSync(new URL('../plugin.json', import.meta.url), 'utf8'));
const extension = manifest.extensions['dev.sailry.platform'];
test('contributes packaged language settings and enable control', () => {
  assert.equal(manifest.version, '0.1.0');
  assert.equal(extension.settings_page.native, undefined);
  assert.equal(extension.settings_page.entry, 'dev.sailry.platform/desktop/settings.js');
  assert.equal(extension.settings_page.enabled_control, true);
  assert.deepEqual(extension.settings_page.placement, {group: 'tools', order: 300});
  assert.equal(extension.settings_page.navigation.label, 'Language services');
  assert.equal(extension.settings_page.navigation.locales['zh-CN'], '语言服务');
  assert.equal(extension.display.label, extension.settings_page.navigation.label);
  assert.deepEqual(extension.display.locales, extension.settings_page.navigation.locales);
  assert.equal(Object.keys(extension.display.locales).length, 9);
  assert.ok(extension.desktop.resources.includes(extension.settings_page.entry));
});
test('binds native queries and lifecycle tools', () => {
  assert.equal(extension.api_version, 'v1');
  assert.deepEqual(extension.actions, ['code.read', 'code.manage', 'code.settings.read', 'code.settings.write']);
  assert.deepEqual(extension.tools.map(tool => tool.operation), ['code.diagnostics','code.definition','code.references','code.hover','code.symbols','code.packages','code.install','code.uninstall']);
  for (const tool of extension.tools) {
    assert.deepEqual(tool.contexts, ['workspace']);
    assert.equal(tool.handler, undefined);
    assert.match(tool.description, /(?:file|symbol|symbols|package|installation|managed)/i);
    assert.ok(tool.display.label && tool.display.locales['zh-CN']);
  }
});
test('explains cold-start consent and incomplete results', () => {
  const instructions = extension.instructions;
  assert.match(instructions, /Ask-mode cold start requests approval/);
  assert.match(instructions, /code_install with that exact descriptor/);
  assert.match(instructions, /Respect disabled services/);
  assert.match(instructions, /only when removal is requested/);
  assert.match(instructions, /partial/);
  assert.match(instructions, /line numbers start at one/);
});
test('selects diagnostics and references before permitted source fallback',()=>{
  assert.match(extension.instructions,/diagnostics, errors or type errors, call code_diagnostics first/);
  assert.match(extension.instructions,/references or usage, call code_references first/);
  assert.match(extension.instructions,/source search only when the query returns not_installed/);
  assert.match(extension.instructions,/say that the required language service is not installed/);
});
