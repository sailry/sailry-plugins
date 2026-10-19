import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// Link the real modules without executing controls or stripping imports.
// GPUI's exports follow the public 98a5e5d module; asElement is not an export.
const exports = {
  'gpui-kit':['View','div','svg','image','list','uniform_list','PathBuilder','Background'],
  'gpui-component':['Button','Checkbox','Field','Form'],
  'sailry':['context','theme'],
  'sailry/sdk':['listRoles','listModels','newRoleId','prepareRole','prepareRemoveRole',
    'completeRequest','forgetRequest','nextChange','faultCode','readSettings','resolveModel'],
  'sailry/forms':['createText','readText','setText','releaseText','nextTextEvent','TextField','SliderField','createSlider','setSlider','nextSliderEvent'],
  'sailry/settings':['prepareSettings'],
  'sailry/ui':['nextControlEvent','nextMenuEvent','modal_closed','toast','dismissToast',
    'EmptyState','SettingsGroup','SettingsRow','IconButton','AppearancePicker','Menu','Modal','Loading'],
};

test('settings link against public module exports',async()=>{
  const context=vm.createContext({}),modules=new Map();
  async function load(url) {
    const key=String(url);
    if(!modules.has(key))modules.set(key,new vm.SourceTextModule(await readFile(url,'utf8'),{context,identifier:key}));
    return modules.get(key);
  }
  async function link(name,owner) {
    if(name.startsWith('.'))return load(new URL(name,owner.identifier));
    assert.ok(exports[name],`Undeclared module ${name}`);
    if(!modules.has(name))modules.set(name,new vm.SyntheticModule(exports[name],function(){
      for(const key of exports[name])this.setExport(key,undefined);
    },{context,identifier:name}));
    return modules.get(name);
  }
  const entry=await load(new URL('../dev.sailry.platform/desktop/settings.js',import.meta.url));
  await entry.link(link);
  assert.equal(entry.status,'linked');
  const invalid=new vm.SourceTextModule("import {asElement} from 'gpui-kit';",{context});
  await assert.rejects(invalid.link(link),/asElement/);
});
