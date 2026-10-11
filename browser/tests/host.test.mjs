import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import * as host from '../dev.sailry.platform/host/main.js';

const manifest = JSON.parse(await readFile(new URL('../plugin.json',import.meta.url),'utf8'));
const extension = manifest.extensions['dev.sailry.platform'];
// Approval groups from the original agent adapter differ from lost-response classification.
const read = new Set('tabs read navigate scroll back forward refresh open focus frame wait'.split(' '));

test('research prefers bound search and anonymous fetch tools', () => {
  assert.match(extension.instructions, /prefer available search tools and GitHub read tools/);
  assert.match(extension.instructions, /web_fetch when it is bound/);
  assert.match(extension.instructions, /anonymous read can complete the task/);
  assert.match(extension.instructions, /page interaction, login, JavaScript rendering/);
  assert.match(extension.instructions, /page view requested by the user/);
  assert.match(extension.instructions, /no suitable search or fetch tool/);
  assert.match(extension.instructions, /without claiming an unavailable tool was used/);
  for (const name of ['browser_read', 'browser_navigate', 'browser_open']) {
    assert.match(extension.tools.find(tool => tool.name === name).description, /Prefer available search/);
    assert.match(extension.tools.find(tool => tool.name === name).description, /web_fetch/);
  }
});

test('all eighteen tools retain approval groups and captured action dispatch', () => {
  assert.equal(extension.tools.length,18);
  assert.equal(new Set(extension.tools.map(tool => tool.name)).size,18);
  assert.deepEqual(new Set(extension.host.handlers),new Set(Object.keys(host)));
  for (const tool of extension.tools) {
    const action = tool.name.slice('browser_'.length);
    const args = action === 'wait' ? {tab:3,condition:{kind:'text',text:'Ready'},timeout_ms:500}
      : {tab:3,snapshot:'captured',element:4,url:'https://example.com',text:'页面 🙂'};
    const original = structuredClone(args);
    assert.equal(tool.handler.name,action);
    assert.equal(tool.handler.operation,`browser.${read.has(action) ? 'read' : 'control'}`);
    assert.equal(tool.presentation,'summary');
    const prepared = ['open','navigate'].includes(action) ? {...original,background:false} : original;
    assert.deepEqual(host[action](args),{action,arguments:prepared});
    assert.deepEqual(args,original);
  }
  assert.equal(extension.tools.find(tool => tool.name === 'browser_screenshot').handler.operation,'browser.control');
});

test('background navigation is explicit and preserves caller arguments', () => {
  for (const action of ['open','navigate']) {
    const tool = extension.tools.find(tool => tool.name === `browser_${action}`);
    assert.deepEqual(tool.handler.parameters.properties.background, {
      type:'boolean',default:false,
      description:'Use true for background automation; false shows the browser sidebar'
    });
    for (const background of [undefined,false,true]) {
      const args = {url:'https://example.com',...(background === undefined ? {} : {background})};
      const original = structuredClone(args);
      assert.deepEqual(host[action](args),{action,arguments:{...args,background:background ?? false}});
      assert.deepEqual(args,original);
    }
    for (const background of [null,'true',0,1,[],{}]) {
      assert.equal(host[action]({url:'https://example.com',background}).error.code,'invalid_request');
    }
    assert.match(tool.description,/background=true for automated reading and interaction/);
    assert.match(tool.description,/defaults to false/);
  }
  for (const tool of extension.tools.filter(tool => !['browser_open','browser_navigate'].includes(tool.name))) {
    assert.equal(tool.handler.parameters.properties.background,undefined);
  }
  assert.match(extension.instructions,/foreground.*user asks to open or view a page/);
  assert.match(extension.instructions,/reads, clicks and screenshots keep that tab in the background/);
});

test('wait validation retains byte bounds and selector kinds', () => {
  for (const condition of [{kind:'text',text:'Ready'},{kind:'visible',selector:'#ready'},{kind:'hidden',selector:'#old'}]) {
    for (const timeout_ms of [1,20000]) {
      const args = {tab:0,condition,timeout_ms};
      assert.deepEqual(host.wait(args),{action:'wait',arguments:args});
    }
  }
  assert.equal(host.wait({condition:{kind:'text',text:'🙂'.repeat(500)},timeout_ms:1}).action,'wait');
  for (const args of [
    {condition:{kind:'text',text:'🙂'.repeat(501)},timeout_ms:1},
    {condition:{kind:'text',text:''},timeout_ms:1},
    {condition:{kind:'unknown',selector:'#ready'},timeout_ms:1},
    {condition:{kind:'text',text:'Ready'},timeout_ms:0},
    {condition:{kind:'text',text:'Ready'},timeout_ms:20001},
    {condition:{kind:'text',text:'Ready'},timeout_ms:1.5}
  ]) assert.equal(host.wait(args).error.code,'invalid_request');
  for (const args of [undefined,null,[],false,'']) assert.equal(host.tabs(args).isError,true);
});

test('success preserves browser payload and known failures supply localized notices', () => {
  const data = {tab:3,snapshot:'snapshot',text:'literal <script> content',elements:[],truncated:true,path:'.generated/capture.jpg'};
  assert.equal(host.result({output:{kind:'browser',data}}),data);
  const failures = [
    'browser tab is empty; navigate to a URL before reading or interacting',
    'browser page is unavailable',
    'browser page failed to load'
  ];
  for (const message of failures) {
    const output = {isError:true,error:{code:'unavailable',message}};
    const annotation = host.result({output});
    assert.equal(annotation.sailry_content.blocks[0].kind,'notice');
    assert.ok(annotation.sailry_content.blocks[0].message.locales['zh-CN']);
    assert.equal(output.error.message,message);
  }
  const unknown = {isError:true,error:{code:'outcome_unknown',message:'Browser response unavailable'}};
  assert.equal(host.result({output:unknown}),unknown);
});
