import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const manifest = JSON.parse(await readFile(new URL('../plugin.json', import.meta.url), 'utf8'));
const extension = manifest.extensions['dev.sailry.platform'];
const [program] = extension.programs;
const [adapter] = extension.model_adapters;
const [provider] = extension.model_providers;
const file = name => program.files.find(entry => entry.path === name).content;

test('declares one program and no script', () => {
  assert.deepEqual(extension.actions, ['models.provide', 'process.run']);
  assert.equal(extension.programs.length, 1);
  assert.equal(program.command, 'agent');
  assert.equal(program.args.at(-1), 'acp');
  assert.equal(adapter.script, undefined);
  assert.equal(extension.host, undefined);
  assert.equal(adapter.acp.program, program.id);
  assert.equal(provider.adapter, adapter.id);
});

test('keeps the sign-in and traffic of the CLI', () => {
  const words = [...program.args, ...Object.keys(program.env ?? {}), ...Object.values(program.env ?? {})].join(' ');
  for (const refused of ['--api-key', '--auth-token', '--endpoint', '-e', '-k', '--header', '--force', '--yolo',
    '--approve-mcps', '--trust', '--print', 'CURSOR_API_KEY', 'CURSOR_AUTH_TOKEN', 'CURSOR_API_ENDPOINT', 'CURSOR_CONFIG_DIR']) {
    assert.ok(!words.split(/[ =]/).includes(refused), refused);
  }
  assert.ok(!JSON.stringify(manifest).includes('{key}'));
  assert.deepEqual(provider.auth, {kind: 'none'});
  assert.equal(adapter.acp.auth_method, 'cursor_login');
  assert.equal(extension.model_auth, undefined);
});

test('keeps every session read-only', () => {
  assert.equal(adapter.acp.mode, 'ask');
  assert.ok(file('AGENTS.md').includes('Use no tool'));
});

test('denies every built-in tool', () => {
  const {permissions} = JSON.parse(file('.cursor/cli.json'));
  assert.deepEqual(permissions.allow, []);
  for (const rule of ['Shell(*)', 'Read(**)', 'Read(/**)', 'Write(**)', 'Write(/**)', 'WebFetch(*)', 'Mcp(*:*)']) {
    assert.ok(permissions.deny.includes(rule), rule);
  }
  const hooks = JSON.parse(file('.cursor/hooks.json'));
  assert.equal(hooks.version, 1);
  const [hook] = hooks.hooks.preToolUse;
  assert.equal(hook.matcher, undefined);
  assert.equal(hook.failClosed, true);
  assert.equal(JSON.parse(hook.command.match(/'(\{.*\})'$/)[1]).permission, 'deny');
});

test('declares the vendor differences', () => {
  assert.equal(adapter.framing, 'ndjson');
  assert.deepEqual(adapter.origins, []);
  assert.equal(adapter.acp.system_meta, undefined);
  assert.equal(adapter.acp.efforts, undefined);
  assert.equal(adapter.acp.model_argument, true);
  assert.deepEqual(program.args.filter(argument => argument.includes('{model}')), ['--model={model}']);
  assert.equal(adapter.acp.replay_bytes, 512 * 1024);
  assert.ok(adapter.acp.sign_in.length <= 256 && !adapter.acp.sign_in.endsWith('.'));
  assert.deepEqual(provider.models, {kind: 'discover'});
});
