import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('./plugin.json', import.meta.url)));
const mcp = JSON.parse(readFileSync(new URL('./mcp.json', import.meta.url)));

test('declares the official remote connection', () => {
  assert.equal(manifest.name, "slack");
  assert.equal(manifest.extensions['dev.sailry.platform'].api_version, 'v1');
  const server = mcp.mcpServers["slack"];
  assert.equal(server.type, 'streamable-http');
  assert.equal(server.url, "https://mcp.slack.com/mcp");
  assert.equal(server.command, undefined);
  assert.equal(server.args, undefined);
  assert.equal(new URL(server.url).username, '');
});

test('keeps registered client secrets out of headers', () => {
  const extension = manifest.extensions['dev.sailry.platform'];
  const schema = JSON.parse(readFileSync(new URL('./dev.sailry.platform/settings.json', import.meta.url)));
  assert.equal(extension.settings_schema, 'dev.sailry.platform/settings.json');
  assert.equal(schema.properties.client_id.type, 'string');
  assert.equal(schema.properties.client_id['x-sailry-secret'], undefined);
  assert.deepEqual(schema.properties.client_secret['x-sailry-secret'], {
    server:'slack',oauth:{client_id:'client_id'},
  });
  assert.equal(schema.properties.client_secret.default, undefined);
  assert.deepEqual(schema.required, ['client_id', 'client_secret']);
  assert.equal(schema.properties.token, undefined);
  assert.deepEqual(mcp.mcpServers.slack.headers ?? {}, {});
  assert.equal(extension.oauth, undefined);
});

test('localizes registered app setup and scope links', () => {
  const schema = JSON.parse(readFileSync(new URL('./dev.sailry.platform/settings.json', import.meta.url)));
  assert.equal(schema.description, schema['x-sailry-locales'].en.description);
  for (const locale of Object.keys(manifest.extensions['dev.sailry.platform'].display.locales)) {
    const labels = schema['x-sailry-locales'][locale];
    assert.ok(labels.client_id && labels.client_secret, locale);
    assert.equal(labels.description.split('\n').length, 4, locale);
    assert.match(labels.description, /https:\/\/api\.slack\.com\/apps/);
    assert.match(labels.description, /https:\/\/docs\.slack\.dev\/ai\/slack-mcp-server\//);
  }
});
