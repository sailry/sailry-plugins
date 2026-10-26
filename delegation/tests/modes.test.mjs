import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const manifest = JSON.parse(await readFile(new URL('../plugin.json',import.meta.url),'utf8'));
const extension = manifest.extensions['dev.sailry.platform'];
const source = (await readFile(new URL('../dev.sailry.platform/host/main.js',import.meta.url),'utf8'))
  .replace(/^import .*\n/gm,'').replace(/^export \{.*\n/gm,'').replace(/^export /gm,'');

test('declares a mode without a model toggle',()=>{
  const [mode] = extension.conversation_modes;
  assert.equal(mode.id,'multitask');
  assert.equal(mode.option,'mode');
  assert.equal(mode.display.label,'Flagship');
  assert.equal(mode.display.locales['zh-CN'],'旗舰');
  assert.deepEqual(mode.permissions,{write:true});
  assert.match(mode.instructions,/enables autonomous delegation/);
  assert.match(mode.instructions,/explicit file ownership/);
  assert.match(mode.instructions,/Children cannot delegate further/);
  assert.equal(extension.conversation_options.properties.mode.default,'');
  assert.deepEqual(extension.conversation_options.properties.mode.enum,['','multitask']);
  assert.equal(extension.ui,undefined);
  assert.equal(extension.desktop.ui_entry,undefined);
});

test('localizes Flagship inside the package',()=>{
  const locales = ['en','zh-CN','zh-TW','ja','ko','de','es','fr','pt-BR','ru'].sort();
  const [mode] = extension.conversation_modes;
  assert.deepEqual(Object.keys(mode.display.locales).sort(),locales);
  assert.deepEqual(Object.keys(extension.description.locales).sort(),locales);
  assert.equal(extension.description.label,manifest.description);
  assert.equal(extension.description.locales['zh-CN'],'多代理协作处理代码和文件，适合重构与整理');
  for (const locale of locales) {
    assert.ok(mode.display.locales[locale].trim());
    assert.ok(extension.description.locales[locale].trim());
    assert.ok(Buffer.byteLength(extension.description.locales[locale]) <= 128);
  }
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
