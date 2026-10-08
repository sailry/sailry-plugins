import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import test from 'node:test';

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
