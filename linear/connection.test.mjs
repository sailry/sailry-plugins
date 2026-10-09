import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('./plugin.json', import.meta.url)));
const mcp = JSON.parse(readFileSync(new URL('./mcp.json', import.meta.url)));

test('declares the official remote connection', () => {
  assert.equal(manifest.name, "linear");
  assert.equal(manifest.extensions['dev.sailry.platform'].api_version, 'v1');
  const server = mcp.mcpServers["linear"];
  assert.equal(server.type, 'streamable-http');
  assert.equal(server.url, "https://mcp.linear.app/mcp/readonly");
  assert.equal(server.command, undefined);
  assert.equal(server.args, undefined);
  assert.equal(new URL(server.url).username, '');
});

test('binds credentials outside package resources', () => {
  const schema = JSON.parse(readFileSync(new URL('./dev.sailry.platform/settings.json', import.meta.url)));
  const binding = schema.properties.token['x-sailry-secret'];
  assert.equal(binding.server, "linear");
  assert.equal(binding.header, "Authorization");
  assert.equal(binding.prefix ?? '', "Bearer ");
  assert.equal(mcp.mcpServers["linear"].headers["Authorization"], '');
  assert.equal(schema.properties.token.default, undefined);
});
