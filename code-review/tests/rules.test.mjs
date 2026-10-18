import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {entries as generated, rules as metadata} from '../dev.sailry.platform/host/rules.js';

const skill = new URL('../skills/code-review/',import.meta.url);
const rules = new URL('rules/',skill);
const index = await readFile(new URL('index.md',rules),'utf8');
const entries = [...index.matchAll(/^\| `([^`]+)` \| ([\w.]+) \|$/gm)].map(([,pattern,rule]) => ({pattern,rule}));
const files = (await readdir(rules)).filter(name => name !== 'index.md');

test('index entries reference bundled rules', () => {
  assert.ok(entries.length > 0);
  for (const {rule} of entries) assert.ok(files.includes(rule),rule);
  assert.equal(new Set(entries.map(entry => entry.pattern)).size,entries.length);
});

test('every bundled rule is reachable', () => {
  const reachable = new Set([...entries.map(entry => entry.rule),'default.md','objc.md']);
  assert.deepEqual(files.filter(name => !reachable.has(name)),[]);
  assert.match(index,/Use `default\.md` when no pattern matches/);
});

test('workflow patterns precede generic YAML', () => {
  const position = pattern => entries.findIndex(entry => entry.pattern === pattern);
  assert.ok(position('.github/workflows/**/*.{yaml,yml}') < position('.github/**/*.{yaml,yml}'));
  assert.ok(position('.github/**/*.{yaml,yml}') < position('**/*.{yaml,yml}'));
});

test('skill loads the index through skill resources', async () => {
  const text = await readFile(new URL('SKILL.md',skill),'utf8');
  assert.match(text,/Read `rules\/index\.md` with `read_skill_resource`/);
});


test('generated metadata preserves rule order and original hashes', async () => {
  assert.deepEqual(generated,entries);
  assert.equal(files.length,54);
  assert.deepEqual(Object.keys(metadata).sort(),files.slice().sort());
  for (const file of files) {
    const body = await readFile(new URL(file,rules));
    assert.deepEqual(metadata[file],{path:`rules/${file}`,sha256:createHash('sha256').update(body).digest('hex')});
  }
});

test('mutating tools declare atomic storage flows', async () => {
  const manifest = JSON.parse(await readFile(new URL('../plugin.json',import.meta.url),'utf8'));
  const extension = manifest.extensions['dev.sailry.platform'];
  assert.equal(manifest.version,'0.1.6');
  assert.equal(extension.api_version,'v1');
  assert.deepEqual(extension.tools.map(tool => tool.name),['review_scope','report_finding','review_complete','delegate_review']);
  assert.equal(extension.tools.find(tool=>tool.name==='review_complete').presentation,'summary');
  assert.equal(extension.tools.find(tool=>tool.name==='report_finding').presentation,'details');
  for (const tool of extension.tools.filter(tool => tool.name !== 'delegate_review')) {
    assert.notEqual(tool.handler.read_only,true);
    assert.deepEqual(tool.handler.flow.operations,['storage.transaction']);
  }
  assert.ok(extension.actions.includes('storage.write'));
  assert.ok(extension.actions.includes('agents.delegate'));
  assert.equal(extension.tools.find(tool => tool.name === 'delegate_review').handler.operation,'agents.delegate');
  assert.deepEqual(extension.host.turn,{initialize:'initialize'});
  assert.ok(extension.instructions.includes('unavailable in Plan mode'));
  const git = JSON.parse(await readFile(new URL('../../git/plugin.json',import.meta.url),'utf8'));
  const native = git.extensions['dev.sailry.platform'].tools
    .find(tool => tool.handler?.operation === 'git.change');
  assert.equal(native.name,'read_git_change');
  const skill = await readFile(new URL('SKILL.md',new URL('../skills/code-review/',import.meta.url)),'utf8');
  assert.ok(skill.includes('`read_git_change`'));
  assert.ok(!skill.includes('`git_change`'));
});

test('skill maps each file to patch arguments', async () => {
  const text = await readFile(new URL('SKILL.md',skill),'utf8');
  assert.match(text,/snapshot: scope\.snapshot/);
  assert.match(text,/path: file\.path/);
  assert.match(text,/expected_metadata_revision: file\.metadata_revision/);
  assert.match(text,/expected_revision: file\.revision/);
  assert.match(text,/Never use it as `expected_metadata_revision`/);
  assert.match(text,/Every request, including a retry or continuation/);
  assert.match(text,/Correct the arguments without replacing the captured scope/);
  const manifest = JSON.parse(await readFile(new URL('../plugin.json',import.meta.url),'utf8'));
  const extension = manifest.extensions['dev.sailry.platform'];
  assert.match(extension.instructions,/file\.metadata_revision as expected_metadata_revision/);
  assert.match(extension.instructions,/omit snapshot\/path on later reads/);
  assert.match(extension.tools.find(tool => tool.name === 'review_scope').description,
    /snapshot\.metadata_revision identifies the inventory, not an individual file/);
  assert.match(text,/the unchanged snapshot/);
  assert.match(text,/each file's metadata and strong revision/);
  assert.match(text,/`record_receipt:true` rejects Plan turns, read-only roles/);
  assert.match(text,/parent must independently verify every assigned file/);
  assert.match(extension.instructions,/Do not ask a read-only child to submit private review records/);
});
