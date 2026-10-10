import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {messages} from '../dev.sailry.platform/desktop/locales.js';
const source=readFileSync(new URL('../dev.sailry.platform/desktop/settings.js',import.meta.url),'utf8')
  .replace(/^import .*;\n/gm,'').replace('export default class','class').replace('export const drivers','const drivers');
const plain=value=>JSON.parse(JSON.stringify(value)),tick=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture() {
  let saved={revision:0,prefer_native:true,fallback:true,providers:{exa:{enabled:true,key_configured:false},searxng:{enabled:true}}};
  const fields=new Map(),secrets=new Set(),calls=[],prepared=[],forgotten=[],notices=[];
  let serial=0,fault=null,hold=false,held=null;const requests=new Map();
  function prepare(value){const id='request-'+(++serial);requests.set(id,plain(value));return id;}
  const Type=vm.runInNewContext(source+'\nSettings',{
    View:class{},context:()=>'{"locale":"en"}',messages,prepareRequest:prepare,
    prepareSettings(value){prepared.push(plain(value));return prepare({kind:'save_search_settings',data:{settings:value.settings}});},
    async completeRequest(id){calls.push(id);const request=requests.get(id);
      if(fault){const code=fault;fault=null;return {Err:{code}};}
      if(request.kind==='read_search_settings'&&hold) {
        hold=false;const result={Ok:{kind:'search_settings',data:plain(saved)}};
        return new Promise(resolve=>{held=()=>resolve(result);});
      }
      if(request.kind==='save_search_settings'){
        if(saved.revision!==request.data.settings.revision)return {Err:{code:'revision_conflict'}};
        saved={...request.data.settings,revision:saved.revision+1};
      }
      return {Ok:{kind:'search_settings',data:plain(saved)}};
    },forgetRequest:id=>forgotten.push(id),faultCode:()=> 'failed',toast:value=>{assert(['info','error'].includes(value.kind));assert.equal(typeof value.message,'string');notices.push(value);},
    createText:value=>{const id='text-'+(++serial);fields.set(id,value);return id;},readText:id=>fields.get(id),releaseText:id=>fields.delete(id),
    createSecret:()=> 'secret-'+(++serial),describeSecret:id=>({filled:secrets.has(id)}),releaseSecret:id=>secrets.delete(id),
    nextChange:()=>new Promise(()=>{}),nextControlEvent:()=>new Promise(()=>{}),modal_closed:()=>new Promise(()=>{})
  });
  const cx={notify(){},spawn:task=>task(cx)};const view=new Type();view.init({},cx);
  async function settle(){for(let i=0;i<10;i++)await tick();}await settle();
  return {view,cx,prepared,fields,secrets,calls,forgotten,notices,settle,fault:code=>{fault=code;},external:()=>{saved={...saved,revision:saved.revision+1,fallback:false};},
    hold:()=>{hold=true;},release:()=>{assert(held);held();held=null;}};
}
test('passes only opaque credential handles',async()=>{
  const f=await fixture();f.view.edit('searxng',f.cx);const editor=f.view.editor;
  f.fields.set(editor.endpoint,'https://example.com');f.secrets.add(editor.key);f.secrets.add(editor.username);
  f.view.saveEditor(f.cx);assert.equal(f.prepared.length,0);assert.equal(f.notices.at(-1).kind,'error');
  f.secrets.add(editor.password);f.view.saveEditor(f.cx);await f.settle();
  assert.deepEqual(f.prepared[0].key,{action:'set',secret:editor.key});
  assert.deepEqual(f.prepared[0].basic,{action:'set',username:editor.username,password:editor.password});
  assert.equal(f.view.editor,null);assert.equal(f.secrets.size,0);
});
test('conflicts retain drafts and retry requires reload',async()=>{
  const f=await fixture();f.view.edit('exa',f.cx);const editor=f.view.editor;f.secrets.add(editor.key);f.external();
  f.view.saveEditor(f.cx);await f.settle();assert.equal(f.view.editor,editor);assert(f.secrets.has(editor.key));
  f.view.reloadEditor(f.cx);f.view.saveEditor(f.cx);await f.settle();
  assert.equal(f.view.editor,null);assert.equal(f.prepared[1].settings.fallback,false);
});
test('unknown outcomes retain request identity and drafts',async()=>{
  const f=await fixture();f.view.edit('exa',f.cx);f.secrets.add(f.view.editor.key);f.fault('outcome_unknown');
  f.view.saveEditor(f.cx);await f.settle();const id=f.view.request.id;
  f.view.close(f.cx);assert(f.view.editor);assert(!f.forgotten.includes(id));
  f.view.saveEditor(f.cx);await f.settle();assert.equal(f.calls.filter(value=>value===id).length,2);
  assert.equal(f.prepared.length,1);assert.equal(f.view.editor,null);
});
test('refresh locks saving and rebasing without discarding drafts',async()=>{
  const f=await fixture();f.view.edit('searxng',f.cx);const editor=f.view.editor;
  f.fields.set(editor.endpoint,'https://draft.example.com');f.secrets.add(editor.key);
  f.external();f.hold();f.view.load(f.cx);await tick();
  const count=f.calls.length;assert(f.view.busy());
  f.view.saveEditor(f.cx);f.view.reloadEditor(f.cx);f.view.toggle('prefer_native',false,f.cx);
  assert.equal(f.calls.length,count);assert.equal(f.prepared.length,0);assert.equal(editor.settings.revision,0);
  assert.equal(f.fields.get(editor.endpoint),'https://draft.example.com');assert(f.secrets.has(editor.key));
  f.release();await f.settle();assert.equal(f.view.saved.revision,1);assert.equal(editor.settings.revision,0);
  f.view.reloadEditor(f.cx);assert.equal(editor.settings.revision,1);
  assert.equal(f.fields.get(editor.endpoint),'https://draft.example.com');assert(f.secrets.has(editor.key));
  f.view.saveEditor(f.cx);await f.settle();assert.equal(f.view.editor,null);
  assert.equal(f.prepared[0].settings.fallback,false);
  assert.equal(f.prepared[0].settings.providers.searxng.endpoint,'https://draft.example.com');
});
