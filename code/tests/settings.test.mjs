import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {rows,installed,installing,available,failure,override} from '../dev.sailry.platform/desktop/model.js';
import {messages} from '../dev.sailry.platform/desktop/locales.js';
const source=readFileSync(new URL('../dev.sailry.platform/desktop/settings.js',import.meta.url),'utf8')
  .replace(/^import .*;\n/gm,'').replace('export default class','class');
const plain=value=>JSON.parse(JSON.stringify(value));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture(locale='en') {
  let saved={revision:0,enabled:true,after_edit:true,servers:{},languages:{}};
  const commands=[],calls=[],forgotten=[],notices=[],fields=new Map(),releases=[];
  let serial=0,fail=null,hold=false,held=null;
  const inventory=[],observers=[];
  const requests=new Map(),row={server:'analyzer',languages:['Rust'],candidate:{server:'analyzer',package:{install:{package:'analyzer',version:'1',revision:'exact',urls:['https://example.com/pinned']}}}};
  const Type=vm.runInNewContext(source+'\nSettings',{
    View:class{},context:()=>JSON.stringify({locale}),messages,rows,override,failure,installing,
    prepareRequest(command){const id='request-'+(++serial);requests.set(id,plain(command));commands.push(plain(command));return id;},
    async completeRequest(id){calls.push(id);const request=requests.get(id);
      if(fail && (!fail.kind || fail.kind===request.kind)){
        const {code,message}=fail;fail=null;return {Err:{code,message}};
      }
      if(request.kind==='read_code_settings') {
        const result={Ok:{data:plain(saved)}};
        if(hold){hold=false;return new Promise(resolve=>{held=()=>resolve(result);});}
        return result;
      }
      if(request.kind==='read_code_catalog')return {Ok:{data:[]}};
      if(request.kind==='list_code_installations')return {Ok:{data:[]}};
      if(request.kind==='read_code_rules')return {Ok:{data:{retrieved:'2026-10-10'}}};
      if(request.kind==='save_code_settings'){
        if(request.data.expected_revision!==saved.revision)return {Err:{code:'revision_conflict'}};
        saved={...request.data.settings,revision:saved.revision+1};return {Ok:{kind:'code_settings',data:plain(saved)}};
      }
      return {Ok:{kind:'code_installation',data:{receipt:{package:'analyzer'}}}};
    },forgetRequest:id=>forgotten.push(id),faultCode:()=> 'failed',toast:value=>{assert(['info','error'].includes(value.kind));assert.equal(typeof value.message,'string');notices.push(value);},
    createText:value=>{const id='field-'+(++serial);fields.set(id,value);return id;},readText:id=>fields.get(id),
    releaseText:id=>releases.push(id),
    nextChange:()=>new Promise(()=>{}),nextCodeInstallations:()=>new Promise(resolve=>{
      if(inventory.length)resolve(inventory.shift());else observers.push(resolve);
    }),
    nextControlEvent:()=>new Promise(()=>{}),nextTextEvent:()=>new Promise(()=>{}),modal_closed:()=>new Promise(()=>{})
  });
  const cx={notify(){},sleep:async()=>{},spawn:task=>task(cx)};
  const view=new Type();view.init({},cx);
  async function settle(){for(let i=0;i<12;i++)await tick();}
  await settle();
  return {view,cx,row,fields,calls,commands,forgotten,notices,releases,settle,
    saved:()=>saved,fail:(code,message,kind)=>{fail={code,message,kind};},external:()=>{saved={...saved,revision:saved.revision+1,after_edit:false};},
    hold:()=>{hold=true;},release:()=>{assert(held);held();held=null;},
    inventory:values=>{const observer=observers.shift();if(observer)observer(plain(values));else inventory.push(plain(values));}};
}

test('unions installed packages and language descriptions',()=>{
  const result=rows([{name:'Rust',id:'rust',servers:[{server:'analyzer',status:'stopped'}]},
    {name:'TOML',servers:[{server:'analyzer',status:'stopped'}]}],[{package:'orphan',receipt:{version:'1'}}]);
  assert.deepEqual(result[0].languages,['Rust','TOML']);assert(result.every(installed));
  assert.throws(()=>override(['','[1]','',''],null));
  assert.throws(()=>override(['','','','{"ENV":1}'],null));
  assert.equal(override(['','','',''],{disabled:true}).disabled,true);
});
test('available rows use Node install descriptors',()=>{
  const candidate=(name,install,status='not_installed')=>({server:name,status,package:{name,install}});
  const catalog=[{name:'Ada',servers:[candidate('build',null),candidate('platform',null),
    candidate('source',null),candidate('toolchain',null),candidate('supported',{package:'supported'}),
    candidate('global',null,'stopped'),candidate('managed',null)]}];
  const installations=[{package:'managed',status:'ready',receipt:{version:'1'}},
    {package:'old',status:'ready',receipt:{version:'1'}},{package:'removed',status:'downloading'}];
  const result=rows(catalog,installations);
  assert.deepEqual(result.filter(available).map(item=>item.server),['removed','supported']);
  assert.deepEqual(result.filter(installed).map(item=>item.server),['global','managed','old']);
  for (const status of ['preparing','downloading','installing']) {
    assert(available({installation:{status}}));
    assert(!available({installation:{status,receipt:{version:'1'}}}));
  }
  for (const status of ['ready','failed','cancelled']) assert(!available({installation:{status}}));
  assert(!available({candidate:{status:'not_installed'}}));
});
test('rule and source failures retain their meaning',()=>{
  const cases=[
    ['language source requires unsupported build or version rules','code_rules_unsupported'],
    ['language source is not supported','code_source_unsupported'],
    ['language package source is not supported by this installer','code_source_unsupported'],
    ['language package URL needs unsupported qualifiers','code_source_unsupported'],
    ['language asset requires unsupported installation rules','code_source_unsupported'],
    ['language package has no asset for this platform','code_package_unavailable'],
    ['language package asset is unavailable on this platform','code_package_unavailable'],
    ['npm is not available in the Node login environment','code_toolchain_unavailable'],
    ['language package is not in the current registry','code_registry_missing'],
    ['Mason registry checksum did not match','code_rules_failed'],
  ];
  for (const [message,key] of cases) {
    assert.equal(failure('invalid_request',message),key);
    assert.equal(failure('outcome_unknown',message),'code_unknown');
  }
  assert.equal(failure('invalid_request','network response','update_code_rules'),'code_rules_failed');
  assert.equal(failure('invalid_request','invalid language asset URL','install_code_server'),'code_package_invalid');
  assert.equal(failure('invalid_request','invalid arguments','save_code_settings'),'code_invalid');
});
test('every locale supplies dialog and error copy',()=>{
  const source=readFileSync(new URL('../dev.sailry.platform/desktop/locales.js',import.meta.url),'utf8')
    .replace(/^export /gm,'');
  const locales=vm.runInNewContext(source+'\nlocales');
  assert.equal(Object.keys(locales).length,10);
  for (const [locale,values] of Object.entries(locales)) {
    assert.deepEqual(Object.keys(values).sort(),Object.keys(locales.en).sort(),locale);
    for (const [key,value] of Object.entries(values)) assert.equal(typeof value,'string',`${locale}:${key}`);
    if (locale!=='en') assert.notEqual(values.settings_cancel,locales.en.settings_cancel,locale);
  }
  assert.equal(messages('zh-CN').settings_cancel,'取消');
  assert.equal(messages('zh-CN').close,'关闭');
});
test('installation faults show translated package errors',async()=>{
  const f=await fixture('zh-CN');
  f.fail('invalid_request','language source requires unsupported build or version rules');
  f.view.submit({kind:'install_code_server',data:{install:f.row.candidate.package.install}},f.cx);
  await f.settle();
  assert.equal(f.notices.at(-1).message,messages('zh-CN').code_rules_unsupported);
  assert.equal(f.view.request,null);
  f.fail('invalid_request','language package is not in the current registry');
  f.view.submit({kind:'install_code_server',data:{install:f.row.candidate.package.install}},f.cx);
  await f.settle();assert.equal(f.notices.at(-1).message,messages('zh-CN').code_registry_missing);
});
test('opening details does not install',async()=>{
  const f=await fixture(),before=f.commands.length;
  f.view.open('details',f.row,f.cx);
  assert.equal(f.view.dialog.kind,'details');
  assert.equal(f.commands.length,before);
  f.view.close(f.cx);
  assert.equal(f.view.dialog,null);
});
test('inventory refresh does not repeat operation feedback',async()=>{
  const f=await fixture();
  for(const status of ['downloading','failed','cancelled','ready']) {
    f.inventory([{package:'analyzer',status,receipt:null}]);await f.settle();
  }
  assert.deepEqual(f.notices,[]);
  f.view.submit({kind:'install_code_server',data:{install:f.row.candidate.package.install}},f.cx);
  await f.settle();
  assert.equal(f.notices.length,1);
  assert.equal(f.notices[0].message,messages('en').code_installed);
  f.inventory([{package:'analyzer',status:'ready',receipt:{package:'analyzer'}}]);await f.settle();
  assert.equal(f.notices.length,1);
});
test('direct install retains capture after details closes',async()=>{
  const f=await fixture();f.view.open('details',f.row,f.cx);
  const descriptor=plain(f.row.candidate.package.install);
  f.fail('outcome_unknown');f.view.install(f.row,f.cx);
  assert.equal(f.view.dialog,null);assert(f.view.pending);
  const id=f.view.request.id;
  f.row.candidate.package.install.version='changed';
  f.view.install(f.row,f.cx);
  assert.deepEqual(plain(f.view.request.command),{kind:'install_code_server',data:{install:descriptor}});
  await f.settle();
  assert.equal(f.view.request.id,id);assert(!f.forgotten.includes(id));
  assert.equal(f.commands.filter(command=>command.kind==='install_code_server').length,1);
  assert.equal(f.calls.filter(value=>value===id).length,1);
  f.view.retry(f.cx);await f.settle();
  assert.equal(f.calls.filter(value=>value===id).length,2);
  assert.equal(f.view.request,null);assert.equal(f.view.dialog,null);
});
test('direct install guards stale and disconnected details',async()=>{
  const f=await fixture();f.view.open('details',f.row,f.cx);
  const before=f.commands.length,owner=f.view.dialog;
  f.view.install({...f.row,server:'other'},f.cx);
  f.view.connected=false;f.view.install(f.row,f.cx);
  assert.equal(f.commands.length,before);assert.equal(f.view.dialog,owner);
  f.view.connected=true;
  f.view.install({...f.row,installation:{status:'downloading'}},f.cx);
  assert.equal(f.commands.length,before);assert.equal(f.view.dialog,owner);
});
test('read and update rule faults show translated errors',async()=>{
  const f=await fixture('zh-CN');
  f.fail('invalid_request','invalid response','read_code_rules');f.view.load(f.cx);
  await f.settle();assert.equal(f.notices.at(-1).message,messages('zh-CN').code_rules_failed);
  f.fail('invalid_request','Mason update has no registry checksum');
  f.view.submit({kind:'update_code_rules'},f.cx);
  await f.settle();assert.equal(f.notices.at(-1).message,messages('zh-CN').code_rules_failed);
});
test('autosave closes only after durable confirmation',async()=>{
  const f=await fixture();f.view.open('edit',f.row,f.cx);
  f.fields.set(f.view.dialog.fields[0],'/custom/analyzer');f.fields.set(f.view.dialog.fields[3],'{"ENV":"kept"}');
  f.view.close(f.cx);assert(f.view.dialog);await f.settle();
  assert.equal(f.view.dialog,null);assert.equal(f.releases.length,4);
  assert.equal(f.saved().servers.analyzer.command,'/custom/analyzer');
  assert.deepEqual(f.saved().servers.analyzer.environment,{ENV:'kept'});assert.equal(f.saved().after_edit,true);
});
test('conflicts preserve drafts until explicit reload',async()=>{
  const f=await fixture();f.view.open('edit',f.row,f.cx);const editor=f.view.dialog;
  f.fields.set(editor.fields[0],'/draft');f.external();f.view.close(f.cx);await f.settle();
  assert.equal(f.view.dialog,editor);assert.equal(editor.blocked,true);assert.equal(f.fields.get(editor.fields[0]),'/draft');
  const before=f.calls.length;f.view.close(f.cx);await f.settle();assert.equal(f.calls.length,before);
  f.view.reloadEditor(f.cx);f.view.close(f.cx);await f.settle();
  assert.equal(f.view.dialog,null);assert.equal(f.saved().servers.analyzer.command,'/draft');assert.equal(f.saved().after_edit,false);
});
test('uncertain saves retry the same request',async()=>{
  const f=await fixture();f.view.open('edit',f.row,f.cx);f.fields.set(f.view.dialog.fields[0],'/draft');
  f.fail('outcome_unknown');f.view.close(f.cx);await f.settle();const id=f.view.request.id;
  assert(!f.forgotten.includes(id));f.view.retry(f.cx);await f.settle();
  assert.equal(f.calls.filter(value=>value===id).length,2);assert.equal(f.view.dialog,null);
});
test('disconnected controls do not dispatch',async()=>{
  const f=await fixture();f.view.connected=false;const count=f.commands.length;
  f.view.toggle('analyzer',false,f.cx);f.view.open('details',f.row,f.cx);
  assert.equal(f.commands.length,count);assert.equal(f.view.dialog,null);
});
test('refresh locks mutations and preserves editor drafts',async()=>{
  const f=await fixture();f.view.open('edit',f.row,f.cx);const editor=f.view.dialog;
  f.fields.set(editor.fields[0],'/draft');f.external();f.hold();f.view.load(f.cx);await tick();
  const writes=f.commands.filter(command=>command.kind==='save_code_settings').length;
  assert(f.view.busy());f.view.toggle('analyzer',false,f.cx);f.view.reloadEditor(f.cx);f.view.close(f.cx);
  assert.equal(f.commands.filter(command=>command.kind==='save_code_settings').length,writes);
  assert.equal(editor.revision,0);assert.equal(f.fields.get(editor.fields[0]),'/draft');assert.equal(f.releases.length,0);
  f.release();await f.settle();assert.equal(f.view.dialog,editor);assert.equal(editor.blocked,true);
  assert.equal(f.view.saved.revision,1);assert.equal(f.fields.get(editor.fields[0]),'/draft');
  f.view.reloadEditor(f.cx);f.view.close(f.cx);await f.settle();
  assert.equal(f.view.dialog,null);assert.equal(f.saved().servers.analyzer.command,'/draft');assert.equal(f.saved().after_edit,false);
});
