import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {rows,installed,override} from '../dev.sailry.platform/desktop/model.js';
import {messages} from '../dev.sailry.platform/desktop/locales.js';
const source=readFileSync(new URL('../dev.sailry.platform/desktop/settings.js',import.meta.url),'utf8')
  .replace(/^import .*;\n/gm,'').replace('export default class','class');
const plain=value=>JSON.parse(JSON.stringify(value));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture() {
  let saved={revision:0,enabled:true,after_edit:true,servers:{},languages:{}};
  const commands=[],calls=[],forgotten=[],notices=[],fields=new Map(),releases=[];
  let serial=0,fail=null,hold=false,held=null;
  const requests=new Map(),row={server:'analyzer',languages:['Rust'],candidate:{server:'analyzer',package:{install:{package:'analyzer',version:'1',revision:'exact',urls:['https://example.com/pinned']}}}};
  const Type=vm.runInNewContext(source+'\nSettings',{
    View:class{},context:()=>'{"locale":"en"}',messages,rows,override,
    prepareRequest(command){const id='request-'+(++serial);requests.set(id,plain(command));commands.push(plain(command));return id;},
    async completeRequest(id){calls.push(id);const request=requests.get(id);
      if(fail){const failure=fail;fail=null;return {Err:{code:failure}};}
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
    nextChange:()=>new Promise(()=>{}),nextCodeInstallations:()=>new Promise(()=>{}),
    nextControlEvent:()=>new Promise(()=>{}),nextTextEvent:()=>new Promise(()=>{}),modal_closed:()=>new Promise(()=>{})
  });
  const cx={notify(){},sleep:async()=>{},spawn:task=>task(cx)};
  const view=new Type();view.init({},cx);
  async function settle(){for(let i=0;i<12;i++)await tick();}
  await settle();
  return {view,cx,row,fields,calls,commands,forgotten,notices,releases,settle,
    saved:()=>saved,fail:code=>{fail=code;},external:()=>{saved={...saved,revision:saved.revision+1,after_edit:false};},
    hold:()=>{hold=true;},release:()=>{assert(held);held();held=null;}};
}

test('unions installed packages and language descriptions',()=>{
  const result=rows([{name:'Rust',id:'rust',servers:[{server:'analyzer',status:'stopped'}]},
    {name:'TOML',servers:[{server:'analyzer',status:'stopped'}]}],[{package:'orphan',receipt:{version:'1'}}]);
  assert.deepEqual(result[0].languages,['Rust','TOML']);assert(result.every(installed));
  assert.throws(()=>override(['','[1]','',''],null));
  assert.throws(()=>override(['','','','{"ENV":1}'],null));
  assert.equal(override(['','','',''],{disabled:true}).disabled,true);
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
  f.view.toggle('analyzer',false,f.cx);f.view.open('install',f.row,f.cx);
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
