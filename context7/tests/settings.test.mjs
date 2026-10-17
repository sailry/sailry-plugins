import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const manifest = JSON.parse(await readFile(new URL('../plugin.json',import.meta.url),'utf8'));
const extension = manifest.extensions['dev.sailry.platform'];
const settings = JSON.parse(await readFile(new URL('../dev.sailry.platform/settings.json',import.meta.url),'utf8'));
const configuration = JSON.parse(await readFile(new URL('../mcp.json',import.meta.url),'utf8'));

test('optional API key uses protected HTTP settings', () => {
  assert.equal(manifest.version,'0.1.1');
  assert.equal(extension.settings_schema,'dev.sailry.platform/settings.json');
  assert.equal(extension.settings_page,undefined);
  assert.deepEqual(settings.required,[]);
  assert.equal(settings.additionalProperties,false);
  assert.deepEqual(Object.keys(settings.properties),['api_key']);
  const key = settings.properties.api_key;
  assert.equal(key.type,'string');
  assert.equal(key.minLength,1);
  assert.equal(key.maxLength,4096);
  assert.equal(key.default,undefined);
  assert.deepEqual(key['x-sailry-secret'],{server:'context7',header:'Context7-API-Key'});
  assert.deepEqual(configuration.mcpServers.context7,{
    type:'streamable-http',url:'https://mcp.context7.com/mcp',headers:{'Context7-API-Key':''},
  });
  for (const locale of ['en','zh-CN','zh-TW','de','es','fr','ja','ko','pt-BR','ru']) {
    assert.ok(settings['x-sailry-locales'][locale].api_key);
  }
});
