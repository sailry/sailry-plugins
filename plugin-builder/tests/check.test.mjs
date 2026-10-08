import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const script = fileURLToPath(new URL('../skills/plugin-builder/scripts/check_package.py', import.meta.url));
const root = fileURLToPath(new URL('../..', import.meta.url));
const created = [];

test.after(() => {
  for (const directory of created) rmSync(directory, {recursive: true, force: true});
});

function check(directory) {
  const result = spawnSync('python3', [script, directory], {encoding: 'utf8'});
  return {code: result.status, output: result.stdout + result.stderr};
}

function fixture(files, name = 'sample') {
  const parent = mkdtempSync(path.join(tmpdir(), 'plugin-builder-'));
  created.push(parent);
  const directory = path.join(parent, name);
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(directory, file);
    mkdirSync(path.dirname(target), {recursive: true});
    writeFileSync(target, typeof content === 'string' ? content : JSON.stringify(content));
  }
  return directory;
}

const manifest = (extension = {}) => ({
  name: 'sample', version: '0.1.0', description: 'Sample',
  extensions: {'dev.sailry.platform': {api_version: 'v1', actions: [], display: {label: 'Sample'}, ...extension}},
});

const skill = '---\nname: sample\ndescription: Explain the sample\n---\n\nSteps\n';

test('accepts a skill package', () => {
  const result = check(fixture({'plugin.json': manifest(), 'skills/sample/SKILL.md': skill}));
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /^ok:/m);
});

test('accepts every official package and example', () => {
  for (const directory of ['plugin-builder', 'progress', 'goals', 'context7', 'examples/task-notes', 'examples/project-summary']) {
    const result = check(path.join(root, directory));
    assert.equal(result.code, 0, `${directory}: ${result.output}`);
  }
});

test('rejects a name that differs from the folder', () => {
  const result = check(fixture({'plugin.json': {...manifest(), name: 'other'}}));
  assert.equal(result.code, 1);
  assert.match(result.output, /must equal the folder name/);
});

test('rejects unknown actions and extension fields', () => {
  const result = check(fixture({'plugin.json': manifest({actions: ['files.everything'], network: true})}));
  assert.match(result.output, /unknown action: files\.everything/);
  assert.match(result.output, /unknown extension field: network/);
});

test('rejects undeclared imports and unavailable modules', () => {
  const directory = fixture({
    'plugin.json': manifest({desktop: {
      entry: 'dev.sailry.platform/desktop/main.js',
      resources: ['dev.sailry.platform/desktop/main.js'],
      panel: {label: 'Sample'},
    }}),
    'dev.sailry.platform/desktop/main.js': 'import {View} from "gpui-kit";\nimport left from "left-pad";\nimport {text} from "./text.js";\n',
    'dev.sailry.platform/desktop/text.js': 'export const text = "";\n',
  });
  const result = check(directory);
  assert.equal(result.code, 1);
  assert.match(result.output, /unavailable module: left-pad/);
  assert.match(result.output, /undeclared resource: \.\/text\.js/);
  assert.doesNotMatch(result.output, /gpui-kit/);
});

test('rejects resources outside the extension folder', () => {
  const directory = fixture({
    'plugin.json': manifest({host: {entry: 'host/main.js', resources: ['host/main.js'], handlers: ['run']}}),
    'host/main.js': 'export function run() {}\n',
  });
  assert.match(check(directory).output, /must be under dev\.sailry\.platform\//);
});

test('rejects script tools without a registered handler', () => {
  const directory = fixture({
    'plugin.json': manifest({
      tools: [{name: 'count', handler: {name: 'count', parameters: {type: 'object'}}}],
      host: {entry: 'dev.sailry.platform/host/main.js', resources: ['dev.sailry.platform/host/main.js'], handlers: []},
    }),
    'dev.sailry.platform/host/main.js': 'export function count() { return {}; }\n',
  });
  assert.match(check(directory).output, /handler 'count' is not in host\.handlers/);
});

test('requires the action behind a bound operation', () => {
  const result = check(fixture({'plugin.json': manifest({tools: [{name: 'save_note', operation: 'storage.set'}]})}));
  assert.match(result.output, /needs the storage\.write action/);
});

const operations = [
  ['files.edit', 'files.write'],
  ['files.find', 'files.read'],
  ['git.show', 'git.read'],
  ['git.blame', 'git.read'],
  ['git.changes', 'git.read'],
  ['git.change', 'git.read'],
];

function bindings(operation) {
  return [
    {name: 'invoke', operation},
    {name: 'invoke', handler: {name: 'invoke', operation, parameters: {type: 'object'}}},
  ];
}

function operationPackage(tool, actions) {
  return fixture({
    'plugin.json': manifest({
      actions,
      tools: [tool],
      host: {
        entry: 'dev.sailry.platform/host/main.js',
        resources: ['dev.sailry.platform/host/main.js'],
        handlers: ['invoke'],
      },
    }),
    'dev.sailry.platform/host/main.js': 'export function invoke(args) { return args; }\n',
  });
}

for (const [operation, action] of operations) {
  test(`requires ${action} for ${operation}`, () => {
    const unrelated = action === 'files.write' ? 'files.read' : 'files.write';
    for (const tool of bindings(operation)) {
      for (const actions of [[], [unrelated]]) {
        const result = check(operationPackage(tool, actions));
        assert.equal(result.code, 1, result.output);
        assert.ok(result.output.includes(`needs the ${action} action`), result.output);
      }
    }
  });

  test(`accepts ${action} for ${operation}`, () => {
    for (const tool of bindings(operation)) {
      const result = check(operationPackage(tool, [action]));
      assert.equal(result.code, 0, result.output);
      assert.match(result.output, /^ok:/m);
    }
  });
}

test('rejects a skill whose name differs from its folder', () => {
  const result = check(fixture({'plugin.json': manifest(), 'skills/notes/SKILL.md': skill}));
  assert.match(result.output, /skills\/notes: name must equal the folder name/);
});
