import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {messages} from '../dev.sailry.platform/desktop/locales.js';
import * as catalog from '../dev.sailry.platform/desktop/catalog.js';
const source=readFileSync(new URL('../dev.sailry.platform/desktop/settings.js',import.meta.url),'utf8')
  .replace(/^import .*;\n/gm,'').replace('export default class','class').replace('export const drivers','const drivers');
const plain=value=>JSON.parse(JSON.stringify(value)),tick=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture() {
  let saved={revision:0,fallback:true,providers:{exa:{enabled:true,key_configured:false},searxng:{enabled:true},
    tinyfish:{enabled:false,key_configured:false},model:{enabled:false,model:null}},
    capabilities:{exa:{quota:'anonymous_quota',key_required:false},searxng:{quota:'keyless',key_required:false},
      tinyfish:{quota:'free_quota',key_required:true},model:{quota:'paid',key_required:false}}};
  let choices={models:[
    {kind:'provider',id:'alpha/first',provider:'Alpha',api:'responses',default:false},
    {kind:'provider',id:'alpha/default',provider:'Alpha',api:'responses',default:true},
    {kind:'provider',id:'beta/vendor/model',provider:'Beta',api:'anthropic',default:true},
    {kind:'provider',id:'gamma/unsupported',provider:'Gamma',api:'chat_completions',default:true},
  ]};
  const fields=new Map(),secrets=new Set(),calls=[],prepared=[],forgotten=[],notices=[];
  let serial=0,fault=null,hold=false,held=null,modelsFault=false;const requests=new Map();
  function prepare(value){const id='request-'+(++serial);requests.set(id,plain(value));return id;}
  const Type=vm.runInNewContext(source+'\nSettings',{
    View:class{},context:()=>'{"locale":"en"}',messages,catalog,prepareRequest:prepare,
    async listModels(){if(modelsFault)throw new Error('catalog unavailable');return plain(choices);},
    prepareSettings(value){prepared.push(plain(value));return prepare({kind:'save_search_settings',data:{settings:value.settings}});},
    async completeRequest(id){calls.push(id);const request=requests.get(id);
      if(fault){const error=fault;fault=null;return {Err:typeof error==='string'?{code:error}:plain(error)};}
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
  return {view,cx,prepared,fields,secrets,calls,forgotten,notices,requests,settle,fault:code=>{fault=code;},external:()=>{saved={...saved,revision:saved.revision+1,fallback:false};},
    models:value=>{choices=plain(value);},failModels:()=>{modelsFault=true;},
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
  f.view.saveEditor(f.cx);f.view.reloadEditor(f.cx);f.view.toggle('fallback',false,f.cx);
  assert.equal(f.calls.length,count);assert.equal(f.prepared.length,0);assert.equal(editor.settings.revision,0);
  assert.equal(f.fields.get(editor.endpoint),'https://draft.example.com');assert(f.secrets.has(editor.key));
  f.release();await f.settle();assert.equal(f.view.saved.revision,1);assert.equal(editor.settings.revision,0);
  f.view.reloadEditor(f.cx);assert.equal(editor.settings.revision,1);
  assert.equal(f.fields.get(editor.endpoint),'https://draft.example.com');assert(f.secrets.has(editor.key));
  f.view.saveEditor(f.cx);await f.settle();assert.equal(f.view.editor,null);
  assert.equal(f.prepared[0].settings.fallback,false);
  assert.equal(f.prepared[0].settings.providers.searxng.endpoint,'https://draft.example.com');
});

test('chooses a provider before its model',async()=>{
  const f=await fixture();f.view.edit('model',f.cx);
  assert.equal(f.fields.size,0);assert.equal(f.secrets.size,0);
  assert.equal(f.view.models.length,3);assert.equal(f.view.editor.model,null);
  f.view.control({id:'search-model-provider',value:'alpha'},f.cx);
  assert.deepEqual(plain(f.view.editor.model),{provider:'alpha',model:'default'});
  f.view.control({id:'search-model-name',value:'vendor/model'},f.cx);
  assert.equal(f.view.editor.model.model,'default');
  f.view.control({id:'search-model-name',value:'first'},f.cx);
  assert.equal(f.view.editor.model.model,'first');
  f.view.control({id:'search-model-provider',value:'beta'},f.cx);
  assert.deepEqual(plain(f.view.editor.model),{provider:'beta',model:'vendor/model'});
  f.view.saveEditor(f.cx);await f.settle();
  const save=[...f.requests.values()].find(request=>request.kind==='save_search_settings');
  assert.deepEqual(save.data.settings.providers.model.model,{provider:'beta',model:'vendor/model'});
  assert.deepEqual(save.data.credentials,{});assert.equal(f.prepared.length,0);assert.equal(f.view.editor,null);
});

test('catalog refresh failures leave search settings usable',async()=>{
  const f=await fixture(),before=f.notices.length;
  f.failModels();f.external();f.view.load(f.cx);await f.settle();
  assert.equal(f.view.saved.revision,1);assert.equal(f.view.saved.fallback,false);
  assert.equal(f.view.busy(),false);assert.equal(f.notices.length,before);
});

test('unavailable models retain the selection draft',async()=>{
  const f=await fixture();f.view.edit('model',f.cx);const editor=f.view.editor;
  f.view.control({id:'search-model-provider',value:'alpha'},f.cx);
  f.models({models:[]});f.view.load(f.cx);await f.settle();
  f.view.saveEditor(f.cx);await f.settle();
  assert.equal(f.view.editor,editor);assert.equal(editor.model.model,'default');
  assert.equal(f.notices.at(-1).message,messages('en').search_model_unavailable);
  assert(![...f.requests.values()].some(request=>request.kind==='save_search_settings'));
});

test('model edits retain uncertain request identity',async()=>{
  const f=await fixture();f.view.edit('model',f.cx);const editor=f.view.editor;
  f.view.control({id:'search-model-provider',value:'alpha'},f.cx);f.fault('outcome_unknown');
  f.view.saveEditor(f.cx);await f.settle();const id=f.view.request.id;
  f.view.close(f.cx);assert.equal(f.view.editor,editor);
  f.view.control({id:'search-model-provider',value:'beta'},f.cx);
  assert.equal(editor.model.provider,'alpha');assert(!f.forgotten.includes(id));
  f.view.saveEditor(f.cx);await f.settle();
  assert.equal(f.calls.filter(value=>value===id).length,2);assert.equal(f.view.editor,null);
  assert.deepEqual(f.requests.get(id).data.settings.providers.model.model,{provider:'alpha',model:'default'});
});

test('distinguishes unsupported searches and expired login',async()=>{
  const f=await fixture();
  f.fault({code:'invalid_request',details:{kind:'search_unsupported'}});
  f.view.test('model',f.cx);await f.settle();
  assert.equal(f.notices.at(-1).message,messages('en').search_not_supported);
  f.fault('expired');f.view.test('model',f.cx);await f.settle();
  assert.equal(f.notices.at(-1).message,messages('en').search_sign_in);
  f.fault({code:'permission_denied',details:{kind:'model_request',reason:'unauthorized'}});
  f.view.test('model',f.cx);await f.settle();
  assert.equal(f.notices.at(-1).message,messages('en').search_test_auth_failed);
});


test('search response failures do not blame settings',async()=>{
  const f=await fixture();
  f.fault({code:'invalid_request',details:{kind:'model_request',reason:'invalid_response'}});
  f.view.test('model',f.cx);await f.settle();
  assert.equal(f.notices.at(-1).message,messages('en').search_request_failed);
  f.view.fail({code:'invalid_request'},true,false);
  assert.equal(f.notices.at(-1).message,messages('en').search_settings_invalid);
});

test('moves services and preserves enable choices',async()=>{
  const f=await fixture(),providers=plain(f.view.saved.providers);
  f.view.control({id:'search-up-model'},f.cx);await f.settle();
  assert.deepEqual(plain(f.view.available()),['exa','tinyfish','model','searxng']);
  assert.deepEqual(plain(f.view.saved.order),f.view.available());
  assert.deepEqual(plain(f.view.saved.providers),providers);
  f.view.control({id:'search-down-model'},f.cx);await f.settle();
  assert.deepEqual(plain(f.view.available()),['exa','tinyfish','searxng','model']);
});

test('ignores moves beyond either list boundary',async()=>{
  const f=await fixture(),revision=f.view.saved.revision;
  f.view.move('exa',-1,f.cx);f.view.move('model',1,f.cx);f.view.move('missing',1,f.cx);
  await f.settle();assert.equal(f.view.saved.revision,revision);
});

test('blocks moves until pending saves complete',async()=>{
  const f=await fixture();
  f.view.move('model',-1,f.cx);f.view.move('model',-1,f.cx);await f.settle();
  assert.equal(f.view.saved.revision,1);
  assert.deepEqual(plain(f.view.available()),['exa','tinyfish','model','searxng']);
});

test('reloads authoritative order after a conflict',async()=>{
  const f=await fixture();f.external();f.view.move('model',-1,f.cx);await f.settle();
  assert.deepEqual(plain(f.view.available()),['exa','tinyfish','searxng','model']);
  assert.equal(f.notices.at(-1).message,messages('en').search_settings_conflict);
});
