import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {checkPackage, dependencies, resource} from '../check-packages.mjs';

function fixture(t, extension = {}) {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'sailry-plugin-check-'));
  t.after(() => rmSync(temp, {recursive: true, force: true}));
  const directory = path.join(temp, 'sample');
  mkdirSync(directory);
  const manifest = path.join(directory, 'plugin.json');
  const data = {name: 'sample', version: '0.1.0', extensions: {
    'dev.sailry.platform': {api_version: 'v1', actions: [], ...extension},
  }};
  writeFileSync(manifest, JSON.stringify(data));
  return {temp, directory, manifest, data};
}

test('syntax parsing never executes package initialization', () => {
  assert.deepEqual(dependencies("import {thing} from './helper.js'; throw Error('must not run');", 'main.js'), ['./helper.js']);
  assert.throws(() => dependencies('export function broken(', 'broken.js'), SyntaxError);
});

test('declared imports and SDK modules remain installable', t => {
  const {directory, manifest} = fixture(t, {desktop: {entry: 'main.js', resources: ['helper.js']}});
  writeFileSync(path.join(directory, 'main.js'), "import './helper.js'; import {value} from 'sailry/sdk';");
  writeFileSync(path.join(directory, 'helper.js'), 'export const value = 1;');
  assert.equal(checkPackage(manifest), 2);
});

test('missing and undeclared imports fail before plugin execution', t => {
  const {directory, manifest} = fixture(t, {desktop: {entry: 'main.js'}});
  writeFileSync(path.join(directory, 'main.js'), "import './helper.js';");
  assert.throws(() => checkPackage(manifest), /ENOENT/);
  writeFileSync(path.join(directory, 'helper.js'), 'export const value = 1;');
  assert.throws(() => checkPackage(manifest), /not a declared/);
  writeFileSync(path.join(directory, 'main.js'), "import {readFile} from 'node:fs';");
  assert.throws(() => checkPackage(manifest), /Unsupported host module/);
});

test('traversal and symlinks cannot escape package assets', t => {
  const {temp, directory} = fixture(t);
  writeFileSync(path.join(temp, 'outside.js'), '');
  for (const value of ['', '../outside.js', '/outside.js', 'folder/../outside.js', 'C:\\outside.js']) {
    assert.throws(() => resource(directory, value));
  }
  symlinkSync(path.join(temp, 'outside.js'), path.join(directory, 'linked.js'));
  assert.throws(() => resource(directory, 'linked.js'), /escapes the package/);
});

test('identity, contract and duplicate declarations fail clearly', t => {
  const {manifest, data} = fixture(t);
  for (const mutate of [
    value => { value.name = 'another'; },
    value => { value.version = 'unversioned'; },
    value => { value.extensions['dev.sailry.platform'].api_version = 'v2'; },
    value => { value.extensions['dev.sailry.platform'].actions = ['read', 'read']; },
    value => { value.extensions['dev.sailry.platform'].desktop = {resources: ['main.js', 'main.js']}; },
    value => { value.extensions['dev.sailry.platform'].tools = [{name: 'read'}, {name: 'read'}]; },
    value => { value.extensions['dev.sailry.platform'].host = {handlers: ['read', 'read']}; },
  ]) {
    const invalid = structuredClone(data);
    mutate(invalid);
    writeFileSync(manifest, JSON.stringify(invalid));
    assert.throws(() => checkPackage(manifest));
  }
});

test('versions accept previews and reject invalid SemVer identifiers', t => {
  const {manifest, data} = fixture(t);
  for (const value of ['0.1.0', '0.1.0-alpha.1', '0.1.0-alpha.1+build.01']) {
    writeFileSync(manifest, JSON.stringify({...data, version: value}));
    assert.equal(checkPackage(manifest), 0);
  }
  for (const value of ['01.1.0', '0.01.0', '0.1.0-alpha.01', '0.1.0-bad_name', '0.1.0-']) {
    writeFileSync(manifest, JSON.stringify({...data, version: value}));
    assert.throws(() => checkPackage(manifest), /semantic version/);
  }
});
