import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const manifest = JSON.parse(fs.readFileSync(new URL('../plugin.json', import.meta.url), 'utf8'));
const extension = manifest.extensions['dev.sailry.platform'];

test('research distinguishes investigations from simple current facts', () => {
  const skill = fs.readFileSync(new URL('../skills/research/SKILL.md', import.meta.url), 'utf8');
  assert.match(skill, /description: Investigate multiple public sources/);
  assert.match(skill, /compare alternatives, synthesize evidence/);
  assert.match(skill, /repeated search rounds/);
  assert.match(skill, /For a simple current fact, search and verify relevant official evidence directly/);
  assert.match(skill, /unnecessary unless the user explicitly selects it/);
  assert.match(skill, /Loading the skill reads workflow instructions; it does not search the web/);
  assert.match(extension.instructions, /multiple sources, comparisons or repeated search rounds/);
  assert.match(extension.instructions, /when available in this turn's skill catalog/);
  assert.match(extension.instructions, /unnecessary unless explicitly selected/);
  assert.match(extension.instructions, /Loading a skill reads instructions, not web results/);
});

test('research follows available search and page-reading capabilities', () => {
  const skill = fs.readFileSync(new URL('../skills/research/SKILL.md', import.meta.url), 'utf8');
  assert.match(skill, /available provider-native search tool or the configured Node `web_search` tool/);
  assert.match(skill, /do not demand a Node fallback tool when native search is advertised instead/);
  assert.match(skill, /available provider-native page-reading tool or `web_fetch`/);
  assert.match(skill, /Search snippets identify candidates; they do not establish a claim/);
  assert.match(skill, /report the limitation rather than inventing a tool or successful access/);
  assert.match(skill, /three search-and-read rounds, six queries and eight distinct fetched sources/);
  assert.match(extension.instructions, /search tools advertised for this turn/);
  assert.match(extension.instructions, /available native page-reading tools or web_fetch/);
  assert.match(extension.instructions, /Do not invent unavailable search or page-reading tools/);
  assert.deepEqual(extension.model_tools.map(tool => tool.capability), ['web_search']);
  assert.deepEqual(extension.tools.map(tool => tool.name), ['web_fetch', 'web_search']);
});

test('contributes packaged search settings and enable control', () => {
  assert.equal(manifest.version, '0.1.7');
  assert.equal(extension.settings_page.native, undefined);
  assert.equal(extension.settings_page.entry, 'dev.sailry.platform/desktop/settings.js');
  assert.equal(extension.settings_page.enabled_control, true);
  assert.deepEqual(extension.settings_page.placement, {group: 'tools', order: 400});
  assert.equal(extension.settings_page.navigation.label, 'Search');
  assert.equal(extension.settings_page.navigation.locales['zh-CN'], '搜索');
  assert.ok(extension.desktop.resources.includes(extension.settings_page.entry));
});

test('binds anonymous page reads beside native search', () => {
  assert.equal(extension.api_version, 'v1');
  assert.deepEqual(extension.actions, ['web.read', 'web.settings.read', 'web.settings.write']);
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
  assert.match(extension.tools[1].description, /five results by default/);
  assert.match(extension.tools[1].description, /no continuation is exposed/);
  assert.equal(extension.tools[0].display.locales['zh-CN'], '读取网页');
});
