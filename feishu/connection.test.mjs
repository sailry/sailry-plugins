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
  const binding = schema.properties.token['x-sailry-secret'];
  assert.equal(binding.server, "feishu");
  assert.equal(binding.header, "X-Lark-MCP-TAT");
  assert.equal(binding.prefix ?? '', "");
  assert.equal(mcp.mcpServers["feishu"].headers["X-Lark-MCP-TAT"], '');
  assert.equal(schema.properties.token.default, undefined);
});

test('limits the initial tool selection to reads', () => {
  assert.equal(mcp.mcpServers.feishu.headers['X-Lark-MCP-Allowed-Tools'], 'get-comments,fetch-doc');
});
