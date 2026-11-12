import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const manifest = JSON.parse(await readFile(new URL('../plugin.json', import.meta.url), 'utf8'));
const extension = manifest.extensions['dev.sailry.platform'];
const [program] = extension.programs;
const [adapter] = extension.model_adapters;
const [provider] = extension.model_providers;

test('declares one program and no script', () => {
  assert.deepEqual(extension.actions, ['models.provide', 'process.run']);
  assert.equal(extension.programs.length, 1);
  assert.equal(program.command, 'claude');
  assert.equal(adapter.script, undefined);
  assert.equal(adapter.acp, undefined);
  assert.equal(extension.host, undefined);
  assert.equal(extension.model_auth, undefined);
  assert.equal(adapter.claude_code.program, program.id);
  assert.equal(provider.adapter, adapter.id);
});

test('leaves the command line and the sign-in alone', () => {
  assert.deepEqual(program.args, []);
  assert.equal(program.files, undefined);
  const words = JSON.stringify(program);
  for (const refused of ['ANTHROPIC_', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CONFIG_DIR', 'BUN_OPTIONS',
    'IS_SANDBOX', 'SSH_CONNECTION', '{key}', '--dangerously-skip-permissions', '--bare', '--system-prompt']) {
    assert.ok(!words.includes(refused), refused);
  }
  assert.deepEqual(provider.auth, {kind: 'none'});
});

test('declares the route', () => {
  assert.equal(adapter.framing, 'ndjson');
  assert.deepEqual(adapter.origins, []);
  assert.equal(adapter.discovery, true);
  assert.deepEqual(adapter.capabilities, {vision: true, tools: true, reasoning: true});
  assert.ok(adapter.claude_code.sign_in.length <= 256 && !adapter.claude_code.sign_in.endsWith('.'));
  assert.deepEqual(provider.models, {kind: 'discover'});
});

test('offers aliases and invents no limit', () => {
  const models = adapter.claude_code.models;
  assert.deepEqual(models.map(model => model.id), ['opus', 'sonnet', 'fable']);
  for (const model of models) {
    assert.equal(model.context, undefined);
    assert.equal(model.output, undefined);
    assert.deepEqual(model.efforts, ['low', 'medium', 'high', 'xhigh', 'max']);
  }
});
