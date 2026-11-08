import test from 'node:test';
import assert from 'node:assert/strict';
import {menu} from '../dev.sailry.platform/desktop/policy.js';
import {fit} from '../dev.sailry.platform/desktop/publication.js';
import {messages} from '../dev.sailry.platform/desktop/locales.js';

const strings=messages('en'),text=key=>strings[key];
const location={project:null,worktree:null,can_retarget:true,projects:[]};
const defaults={label:null,icon:null,dropdown:false,visible:true,enabled:true,loading:false,
  value:null,choices:null,details:[],segments:[],reply_to:null};
function payload(choices,value='unassigned') {
  return [
    {id:'location',enabled:true,choices,value,label:{label:'Project'},icon:'folder',reply_to:7},
    {id:'manage',enabled:true,visible:true},
    {id:'create',enabled:true,visible:true},
    {id:'fork',enabled:true,visible:true},
  ];
}
function encoded(states) {
  return JSON.stringify(states.map(entry=>({...defaults,...entry,
    label:entry.label ? {locales:{},...entry.label} : null,
    choices:entry.choices?.map(choice=>({enabled:true,description:null,icon:null,group:null,...choice,
      icon:choice.icon ?? null,label:{locales:{},...choice.label},
      group:choice.group ? {locales:{},...choice.group} : null})) ?? null,
  })));
}
function projects(count,name=index=>`Project ${index}`) {
  return Array.from({length:count},(_,index)=>({id:`00000000-0000-0000-0000-${String(index).padStart(12,'0')}`,name:name(index)}));
}

test('complete menus preserve their published state',()=>{
  const choices=menu({...location,projects:projects(10)},null,null,text);
  const states=payload(choices);
  assert.equal(fit(states,text),states);
  assert.equal(states[0].choices,choices);
  assert.equal(states[0].choices.some(choice=>choice.id==='projects'),false);
});

test('count limits retain actions and full project selection',()=>{
  for(const count of [254,255,1000]) {
    const states=fit(payload(menu({...location,projects:projects(count)},null,null,text)),text);
    const choices=states[0].choices;
    assert.equal(choices.length,256);
    assert.ok(choices.some(choice=>choice.id==='unassigned'));
    assert.ok(choices.some(choice=>choice.id==='add_project'));
    assert.equal(choices.some(choice=>choice.id==='projects'),count>254);
    assert.ok(Buffer.byteLength(encoded(states),'utf8')<=64*1024);
    assert.equal(states[0].reply_to,7);
  }
});

test('UTF8 budgets include envelopes and host defaults',()=>{
  for(const name of ['界'.repeat(42),'🙂'.repeat(32)]) {
    const states=payload(menu({...location,projects:projects(250,()=>name)},null,null,text));
    const full=encoded(states);
    assert.ok(full.length<64*1024);
    assert.ok(Buffer.byteLength(full,'utf8')>64*1024);
    fit(states,text);
    assert.ok(states[0].choices.length<252);
    assert.ok(states[0].choices.some(choice=>choice.id==='projects'));
    assert.ok(states[0].choices.some(choice=>choice.id==='add_project'));
    assert.ok(Buffer.byteLength(encoded(states),'utf8')<=64*1024);
  }
});

test('worktree menus retain selected entries and management',()=>{
  const trees=Array.from({length:500},(_,index)=>({id:`tree-${index}`,path:`/tree-${index}`,main:index===0}));
  const selected='tree-499';
  const state={...location,project:'project',worktree:selected,project_name:'Project',branch:'selected',git:true,session:'session'};
  const entries=trees.map(tree=>({...tree,branch:'界'.repeat(42),available:true}));
  const states=fit(payload(menu(state,{projects:[],worktrees:trees},entries,text),`worktree:${selected}`),text);
  const ids=states[0].choices.map(choice=>choice.id);
  assert.ok(ids.includes(`worktree:${selected}`));
  for(const action of ['create','fork','manage','projects'])assert.ok(ids.includes(action));
  assert.ok(ids.length<=256);
  assert.ok(Buffer.byteLength(encoded(states),'utf8')<=64*1024);
});

test('escaped labels use their serialized byte size',()=>{
  const choices=menu({...location,projects:projects(250,()=>'"\\'.repeat(64))},null,null,text);
  const states=fit(payload(choices),text);
  assert.ok(Buffer.byteLength(encoded(states),'utf8')<=64*1024);
  assert.ok(states[0].choices.some(choice=>choice.id==='projects'));
});
