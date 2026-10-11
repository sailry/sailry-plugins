import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('./plugin.json', import.meta.url)));
const mcp = JSON.parse(readFileSync(new URL('./mcp.json', import.meta.url)));

test('declares the official remote connection', () => {
  assert.equal(manifest.name, "feishu");
  assert.equal(manifest.extensions['dev.sailry.platform'].api_version, 'v1');
  const server = mcp.mcpServers["feishu"];
  assert.equal(server.type, 'streamable-http');
  assert.equal(server.url, "https://mcp.feishu.cn/mcp");
  assert.equal(server.command, undefined);
  assert.equal(server.args, undefined);
  assert.equal(new URL(server.url).username, '');
});

test('binds credentials outside package resources', () => {
  const schema = JSON.parse(readFileSync(new URL('./dev.sailry.platform/settings.json', import.meta.url)));
  const binding = schema.properties.app_secret['x-sailry-secret'];
  assert.deepEqual(binding, {server:'feishu',header:'X-Lark-MCP-TAT',
    application:{provider:'feishu',client_id:'app_id'}});
  assert.equal(schema.properties.app_id.type, 'string');
  assert.equal(schema.properties.app_id['x-sailry-secret'], undefined);
  assert.equal(schema.properties.app_id.minLength, 1);
  assert.deepEqual(schema.required, ['app_id', 'app_secret']);
  assert.equal(schema.properties.token, undefined);
  assert.equal(mcp.mcpServers["feishu"].headers["X-Lark-MCP-TAT"], '');
  assert.equal(schema.properties.app_secret.default, undefined);
  assert.equal(manifest.extensions['dev.sailry.platform'].oauth, undefined);
});

test('limits the initial tool selection to reads', () => {
  assert.equal(mcp.mcpServers.feishu.headers['X-Lark-MCP-Allowed-Tools'], 'get-comments,fetch-doc');
});

test('localizes four setup steps and permission links', () => {
  const schema = JSON.parse(readFileSync(new URL('./dev.sailry.platform/settings.json', import.meta.url)));
  assert.equal(schema.description, schema['x-sailry-locales'].en.description);
  for (const locale of Object.keys(manifest.extensions['dev.sailry.platform'].display.locales)) {
    const labels = schema['x-sailry-locales'][locale];
    assert.ok(labels.app_id && labels.app_secret, locale);
    assert.equal(labels.description.split('\n').length, 4, locale);
    assert.match(labels.description, /https:\/\/open\.feishu\.cn\/app/);
    assert.match(labels.description, /https:\/\/open\.feishu\.cn\/document\/mcp_open_tools\/supported-tools/);
  }
});
