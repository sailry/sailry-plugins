import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import vm from 'node:vm';

const manifest = JSON.parse(readFileSync(new URL('./plugin.json', import.meta.url)));
const extension = manifest.extensions['dev.sailry.platform'];
const settings = JSON.parse(readFileSync(new URL('./dev.sailry.platform/settings.json', import.meta.url)));
const source = readFileSync(new URL('./dev.sailry.platform/host/main.js', import.meta.url), 'utf8').replace(/^export /gm, '');
const read = vm.runInNewContext(`${source}\n({read})`).read;
const plain = value => JSON.parse(JSON.stringify(value));
const outcome = (body, status = 200) => ({data:{status, headers:{}, body:JSON.stringify(body)}});

test('declares PAT REST without an automatic MCP connection', () => {
  assert.equal(manifest.name, 'figma');
  assert.equal(manifest.version, '0.1.0');
  assert.equal(extension.api_version, 'v1');
  assert.equal(existsSync(new URL('./mcp.json', import.meta.url)), false);
  assert.deepEqual(extension.actions, ['http.request']);
  assert.deepEqual(extension.tools[0].handler.flow.operations, ['http.request']);
  assert.equal(extension.tools[0].handler.parameters.additionalProperties, false);
  assert.deepEqual(extension.tools[0].handler.parameters.properties.action.enum, ['file','nodes']);
  assert.deepEqual(settings.properties.token['x-sailry-secret'], {
    origin:'https://api.figma.com', header:'X-Figma-Token'
  });
  assert.equal(settings.properties.token.default, undefined);
  assert.deepEqual(settings.required, ['token']);
  assert.equal(Object.keys(settings['x-sailry-locales']).length, 10);
  for (const locale of Object.values(settings['x-sailry-locales'])) {
    assert.ok(locale.description.includes('https://developers.figma.com/docs/rest-api/personal-access-tokens/'));
    assert.ok(locale.description.includes('file_content:read'));
    assert.ok(locale.description.includes('MCP'));
  }
});

test('reads exact files and nodes with bounded parameters', () => {
  const file = plain(read({step:0, arguments:{action:'file', file_key:'file-key', version:'9007199254740993', depth:2}}));
  assert.equal(file.call.operation, 'http.request');
  assert.equal(file.call.arguments.method, 'GET');
  assert.equal(file.call.arguments.credential, 'token');
  assert.equal(file.call.arguments.body, null);
  assert.deepEqual(file.call.arguments.headers, {Accept:'application/json'});
  assert.equal(file.call.arguments.url, 'https://api.figma.com/v1/files/file-key?version=9007199254740993&depth=2');
  const nodes = new URL(read({step:0, arguments:{action:'nodes', file_key:'file-key', ids:['1:2','I3:4;5:6']}}).call.arguments.url);
  assert.equal(nodes.origin, 'https://api.figma.com');
  assert.equal(nodes.pathname, '/v1/files/file-key/nodes');
  assert.equal(nodes.searchParams.get('ids'), '1:2,I3:4;5:6');
  for (const args of [
    {action:'edit',file_key:'file-key'}, {action:'file',file_key:'../secret'},
    {action:'file',file_key:'https://evil.test'}, {action:'file',file_key:'file-key',url:'https://evil.test'},
    {action:'file',file_key:'file-key',token:'secret'}, {action:'file',file_key:'file-key',headers:{}},
    {action:'file',file_key:'file-key',ids:['1:2']}, {action:'nodes',file_key:'file-key'},
    {action:'nodes',file_key:'file-key',ids:[]}, {action:'nodes',file_key:'file-key',ids:['1:2','1:2']},
    {action:'nodes',file_key:'file-key',ids:['1,2']}, {action:'nodes',file_key:'file-key',ids:['1\n2']},
    {action:'file',file_key:'file-key',version:9007199254740993},
    ...[0,101,1.5,null].map(depth => ({action:'file',file_key:'file-key',depth})),
  ]) assert.throws(() => read({step:0, arguments:args}));
});

test('preserves JSON metadata and missing nodes honestly', () => {
  const data = {name:'Actual file', version:'9007199254740993', document:{id:'0:0', children:[]}};
  const result = plain(read({step:1, arguments:{action:'file',depth:1}, outcome:outcome(data)}));
  assert.deepEqual(result.result, {data,untrusted:true,depth:1,partial:true});
  const nodes = {version:'9007199254740993', nodes:{'1:2':null,'3:4':{document:{id:'3:4'}}}};
  assert.deepEqual(plain(read({step:1,arguments:{action:'nodes'},outcome:outcome(nodes)})).result,
    {data:nodes,untrusted:true,depth:null,partial:true});
});

test('preserves errors without retry or private response bodies', () => {
  const uncertain = {isError:true,error:{code:'outcome_unknown',message:'interrupted'}};
  assert.deepEqual(plain(read({step:1,outcome:uncertain})), {result:uncertain});
  for (const status of [401,403,429]) {
    const reply = {data:{status,body:'private error marker',headers:{'retry-after':['12']}}};
    const result = plain(read({step:1,arguments:{action:'file'},outcome:reply}));
    assert.equal(result.result.isError, true);
    assert.equal(result.result.status, status);
    assert.equal(result.result.retry_after, '12');
    assert.equal(result.call, undefined);
    assert.equal(JSON.stringify(result).includes('private error marker'), false);
  }
  for (const reply of [outcome([]),outcome({}),{data:{status:200,body:'invalid'}},outcome({nodes:[]})]) {
    assert.equal(read({step:1,arguments:{action:'nodes'},outcome:reply}).result.isError, true);
  }
});
