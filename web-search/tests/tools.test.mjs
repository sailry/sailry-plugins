import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const manifest = JSON.parse(fs.readFileSync(new URL('../plugin.json', import.meta.url), 'utf8'));
const extension = manifest.extensions['dev.sailry.platform'];

test('contributes host search settings and the shared enable control', () => {
  assert.equal(manifest.version, '0.2.1');
  assert.equal(extension.settings_page.native, 'search');
  assert.equal(extension.settings_page.entry, null);
  assert.equal(extension.settings_page.enabled_control, true);
  assert.deepEqual(extension.settings_page.placement, {group: 'tools', order: 400});
  assert.equal(extension.settings_page.navigation.label, 'Search');
  assert.equal(extension.settings_page.navigation.locales['zh-CN'], '搜索');
  assert.equal(extension.desktop, undefined);
});

test('binds anonymous page reads beside native search', () => {
  assert.equal(extension.api_version, 'v1');
  assert.deepEqual(extension.actions, ['web.read']);
  assert.equal(extension.model_tools[0].capability, 'web_search');
  assert.equal(extension.tools[0].name, 'web_fetch');
  assert.equal(extension.tools[0].operation, 'web.fetch');
  assert.equal(extension.tools[0].handler, undefined);
  assert.match(extension.tools[0].description, /without a token/);
  assert.match(extension.tools[0].description, /10 MiB, 30 seconds and five redirects/);
  assert.match(extension.instructions, /untrusted external data/);
  assert.match(extension.tools[0].description, /20,000 Unicode characters/);
  assert.match(extension.tools[0].description, /next_offset/);
  assert.match(extension.tools[0].description, /100 documents/);
  assert.equal(extension.tools[1].name, 'web_search');
  assert.equal(extension.tools[1].operation, 'web.search');
  assert.match(extension.tools[1].description, /five results by default and at most ten/);
  assert.equal(extension.tools[0].display.locales['zh-CN'], '读取网页');
});
