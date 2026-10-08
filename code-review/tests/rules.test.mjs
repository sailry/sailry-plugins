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
  assert.equal(manifest.version,'0.3.0');
  assert.equal(extension.api_version,'v1');
  assert.deepEqual(extension.tools.map(tool => tool.name),['review_scope','report_finding','review_complete']);
  for (const tool of extension.tools) {
    assert.notEqual(tool.handler.read_only,true);
    assert.deepEqual(tool.handler.flow.operations,['storage.transaction']);
  }
  assert.ok(extension.actions.includes('storage.write'));
  assert.ok(extension.instructions.includes('unavailable in Plan mode'));
  const git = JSON.parse(await readFile(new URL('../../git/plugin.json',import.meta.url),'utf8'));
  const native = git.extensions['dev.sailry.platform'].tools
    .find(tool => tool.handler?.operation === 'git.change');
  assert.equal(native.name,'read_git_change');
  const skill = await readFile(new URL('SKILL.md',new URL('../skills/code-review/',import.meta.url)),'utf8');
  assert.ok(skill.includes('`read_git_change`'));
  assert.ok(!skill.includes('`git_change`'));
});
