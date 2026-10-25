import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const manifest = JSON.parse(await readFile(new URL('../plugin.json',import.meta.url),'utf8'));
const extension = manifest.extensions['dev.sailry.platform'];
const source = (await readFile(new URL('../dev.sailry.platform/host/main.js',import.meta.url),'utf8'))
  .replace(/^import .*\n/gm,'').replace(/^export \{.*\n/gm,'').replace(/^export /gm,'');

test('multitask contributes an explicit mode without a model toggle',()=>{
  const [mode] = extension.conversation_modes;
  assert.equal(mode.id,'multitask');
  assert.equal(mode.option,'mode');
  assert.equal(mode.display.locales['zh-CN'],'多任务');
  assert.deepEqual(mode.permissions,{write:true});
  assert.match(mode.instructions,/enables autonomous delegation/);
  assert.match(mode.instructions,/explicit file ownership/);
  assert.match(mode.instructions,/Children cannot delegate further/);
  assert.equal(extension.conversation_options.properties.mode.default,'');
  assert.deepEqual(extension.conversation_options.properties.mode.enum,['','multitask']);
  assert.equal(extension.ui,undefined);
  assert.equal(extension.desktop.ui_entry,undefined);
});

test('retained proactive choices do not enable default delegation',()=>{
  const initialize = vm.runInNewContext(`${source}\ninitialize`,{
    stageTurnState(){},readTurnState(){return {};},
  });
  for (const options of [{},{proactive:true},{proactive:true,mode:'multitask'}]) {
    const result = initialize({tools:['spawn_agent'],roles:[],options});
    assert.deepEqual(JSON.parse(JSON.stringify(result.tools)),['spawn_agent']);
    assert.doesNotMatch(result.instruction,/autonomous delegation|Proactive delegation/);
  }
  assert.equal(extension.conversation_options.properties.proactive.type,'boolean');
});
