import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

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
});

test('research follows available search and page-reading capabilities', () => {
  const skill = fs.readFileSync(new URL('../skills/research/SKILL.md', import.meta.url), 'utf8');
  assert.match(skill, /configured Node `web_search` tool/);
  assert.match(skill, /with `web_fetch`/);
  assert.match(skill, /Search snippets identify candidates; they do not establish a claim/);
  assert.match(skill, /report the limitation rather than inventing a tool or successful access/);
  assert.match(skill, /three search-and-read rounds, six queries and eight distinct fetched sources/);
  assert.equal(extension.model_tools, undefined);
  assert.equal(extension.tools, undefined);
  assert.equal(extension.instructions, undefined);
});

test('contributes packaged search settings and enable control', () => {
  assert.equal(manifest.version, '0.1.22');
  assert.equal(extension.min_sailry_version, '0.1.6');
  assert.equal(extension.settings_page.native, undefined);
  assert.equal(extension.settings_page.entry, 'dev.sailry.platform/desktop/settings.js');
  assert.equal(extension.settings_page.enabled_control, true);
  assert.deepEqual(extension.settings_page.placement, {group: 'tools', order: 400});
  assert.equal(extension.settings_page.navigation.label, 'Search');
  assert.equal(extension.settings_page.navigation.locales['zh-CN'], '搜索');
  assert.ok(extension.desktop.resources.includes(extension.settings_page.entry));
  assert.equal(extension.api_version, 'v1');
  assert.deepEqual(extension.actions, ['web.read', 'web.settings.read', 'web.settings.write', 'models.read']);
});

test('translates new controls and release notes',()=>{
  const source=fs.readFileSync(new URL('../dev.sailry.platform/desktop/locales.js',import.meta.url),'utf8');
  const locales=vm.runInNewContext(source.replace(/^export .*$/m,'')+'\nlocales');
  assert.equal(Object.keys(locales).length,10);
  for(const [locale,entries] of Object.entries(locales)) {
    for(const key of ['search_driver_tinyfish','search_driver_volcengine','search_driver_deepseek','search_driver_model',
      'search_quota_keyless','search_quota_anonymous_quota','search_quota_free_quota','search_quota_paid',
      'search_reorder','search_model_name','search_model_follow','search_model_unavailable','search_not_supported','search_sign_in']) {
      assert.equal(typeof entries[key],'string',`${locale}: ${key}`);assert(entries[key]);
    }
    const name=locale==='en'?'CHANGELOG.md':`CHANGELOG.${locale}.md`;
    assert.match(fs.readFileSync(new URL(`../${name}`,import.meta.url),'utf8'),/^## 0\.1\.11$/m);
  }
});
