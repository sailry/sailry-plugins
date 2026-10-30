import assert from 'node:assert/strict';
import test from 'node:test';
import {available,needsKey,models,providers,binding,contains} from '../dev.sailry.platform/desktop/catalog.js';

test('offers only advertised drivers',()=>{
  assert.deepEqual(available({providers:{model:{},exa:{},volcengine:{},tinyfish:{},unknown:{}}}),
    ['exa','tinyfish','volcengine','model']);
  assert.deepEqual(available(null),[]);
  assert.equal(needsKey({key_required:true}),true);
  assert.equal(needsKey({key_required:false}),false);
});

test('filters unsupported interfaces and login methods',()=>{
  const choices=models({models:[
    {kind:'provider',id:'one/first',provider:'One',api:'responses',authentication:'api_key'},
    {kind:'provider',id:'one/second',provider:'One',api:'responses',authentication:'chat_gpt_o_auth',default:true},
    {kind:'provider',id:'two/vendor/model',provider:'Two',api:'anthropic',authentication:'plugin'},
    {kind:'provider',id:'three/search',provider:'Three',api:'gemini',authentication:'api_key'},
    {kind:'provider',id:'four/chat',provider:'Four',api:'chat_completions'},
    {kind:'provider',id:'five/plugin',provider:'Five',api:'plugin'},
    {kind:'provider',id:'copilot/search',provider:'Copilot',api:'responses',authentication:'copilot'},
    {kind:'provider',id:'copilot/claude',provider:'Copilot',api:'anthropic',authentication:'copilot'},
    {kind:'provider',id:'invalid',provider:'Invalid',api:'responses'},
  ]});
  assert.deepEqual(providers(choices),[{id:'one',label:'One'},{id:'two',label:'Two'},{id:'three',label:'Three'}]);
  assert.deepEqual(binding(choices,'one'),{provider:'one',model:'second'});
  assert.deepEqual(binding(choices,'two'),{provider:'two',model:'vendor/model'});
  assert.equal(binding(choices,'four'),null);
  assert.equal(contains(choices,{provider:'three',model:'search'}),true);
  assert.equal(contains(choices,{provider:'one',model:'vendor/model'}),false);
  assert.equal(contains(choices,null),false);
});

test('uses the saved service order',()=>{
  assert.deepEqual(available({order:['model','exa','tinyfish'],providers:{exa:{},model:{},tinyfish:{}}}),
    ['model','exa','tinyfish']);
});
