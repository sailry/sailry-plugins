import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('./plugin.json', import.meta.url)));
const mcp = JSON.parse(readFileSync(new URL('./mcp.json', import.meta.url)));

test('declares the official remote connection', () => {
  assert.equal(manifest.name, "tencent-docs");
  assert.equal(manifest.extensions['dev.sailry.platform'].api_version, 'v1');
  const server = mcp.mcpServers["tencent-docs"];
  assert.equal(server.type, 'streamable-http');
  assert.equal(server.url, "https://docs.qq.com/openapi/mcp");
  assert.equal(server.command, undefined);
  assert.equal(server.args, undefined);
  assert.equal(new URL(server.url).username, '');
});

test('binds credentials outside package resources', () => {
  const schema = JSON.parse(readFileSync(new URL('./dev.sailry.platform/settings.json', import.meta.url)));
  const binding = schema.properties.token['x-sailry-secret'];
  assert.equal(binding.server, "tencent-docs");
  assert.equal(binding.header, "Authorization");
  assert.equal(binding.prefix ?? '', "");
  assert.equal(mcp.mcpServers["tencent-docs"].headers["Authorization"], '');
  assert.equal(schema.properties.token.default, undefined);
});


test('provides localized official credential guidance', () => {
  const schema = JSON.parse(readFileSync(new URL('./dev.sailry.platform/settings.json', import.meta.url)));
  assert.ok(schema.description.includes("https://docs.qq.com/open/auth/mcp.html"));
  assert.equal(Object.keys(schema['x-sailry-locales']).length, 10);
  for (const locale of Object.values(schema['x-sailry-locales']))
    assert.ok(locale.description.includes("https://docs.qq.com/open/auth/mcp.html"));
  assert.equal(schema.properties.token.default, undefined);
});
