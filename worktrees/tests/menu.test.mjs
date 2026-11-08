import test from 'node:test';
import assert from 'node:assert/strict';
import {menu} from '../dev.sailry.platform/desktop/policy.js';
import {messages} from '../dev.sailry.platform/desktop/locales.js';

const strings=messages('en'),text=key=>strings[key];
const location={project:'project',worktree:'main',main:true,branch:'main',session:null,git:true,can_retarget:true,
  project_name:'Project',projects:[{id:'project',name:'Project'}]};
const catalog={projects:location.projects,worktrees:[
  {id:'topic',path:'/topic',main:false},{id:'main',path:'/main',main:true},
]};
const entries=[{path:'/main',branch:'main',main:true,available:true},
  {path:'/topic',branch:'feature',main:false,available:true}];

test('unassigned locations list projects and their creation action',()=>{
  const choices=menu({...location,project:null},null,null,text);
  assert.deepEqual(choices.map(choice=>choice.id),['unassigned','project:project','add_project']);
  assert.equal(choices[0].label.label,'Chats');
  assert.equal(choices[1].icon,'folder');
  assert.deepEqual(choices[0].group,choices[1].group);
  assert.notDeepEqual(choices[1].group,choices[2].group);
  assert.deepEqual(menu({...location,project:null,can_retarget:false},null,null,text),[]);
});

test('project menus group registered worktrees and actions',()=>{
  const choices=menu(location,catalog,entries,text);
  assert.deepEqual(choices.map(choice=>choice.id),['projects','worktree:main','worktree:topic','create','manage']);
  assert.deepEqual(choices.slice(1,3).map(choice=>[choice.label.label,choice.icon]),
    [['Main workspace (main)','folder'],['feature','network']]);
  assert.notDeepEqual(choices[0].group,choices[1].group);
  assert.deepEqual(choices[1].group,choices[2].group);
  assert.notDeepEqual(choices[2].group,choices[3].group);
  assert.deepEqual(choices[3].group,choices[4].group);
  assert.equal(choices[4].label.label,'Manage worktrees…');
});

test('forking requires both Git and a session',()=>{
  for(const git of [false,true])for(const session of [null,'session']) {
    const choices=menu({...location,git,session,can_retarget:!session},catalog,entries,text);
    assert.equal(choices.some(choice=>choice.id==='create'),git);
    assert.equal(choices.some(choice=>choice.id==='fork'),git && !!session);
    assert.equal(choices.find(choice=>choice.id==='projects').enabled,!session);
    assert.ok(choices.some(choice=>choice.id==='manage'));
  }
});

test('main labels retain their own branch elsewhere',()=>{
  const choices=menu({...location,worktree:'topic',branch:'feature'},catalog,entries,text);
  assert.equal(choices[1].label.label,'Main workspace (main)');
  assert.equal(choices[2].label.label,'feature');
});

test('unavailable worktrees remain visible without an action',()=>{
  const choices=menu(location,catalog,entries.map(entry=>({...entry,available:false})),text);
  assert.equal(choices[1].enabled,false);
  assert.equal(choices[2].enabled,false);
});

test('list labels preserve complete dynamic names',()=>{
  const choices=menu({...location,project:null,projects:[{id:'project',name:'a'.repeat(129)}]},null,null,text);
  assert.equal(choices[1].label.label,'a'.repeat(129));
  const branches=menu({...location,branch:'a'.repeat(128)},catalog,entries,text);
  assert.equal(branches[1].label.label,`Main workspace (${'a'.repeat(128)})`);
});

test('incomplete discovery shows only the bound human label',()=>{
  for(const cached of [null,catalog]) for(const main of [true,false]) {
    const state={...location,main,worktree:main ? 'main' : 'topic',branch:main ? 'main' : 'feature'};
    const choices=menu(state,cached,null,text).filter(choice=>choice.id.startsWith('worktree:'));
    assert.equal(choices.length,1);
    assert.equal(choices[0].id,`worktree:${state.worktree}`);
    assert.equal(choices[0].label.label,main ? 'Main workspace (main)' : 'feature');
  }
});

test('project navigation exposes a return row and every project',()=>{
  const choices=menu(location,catalog,entries,text,true);
  assert.deepEqual(choices.map(choice=>choice.id),['worktrees','unassigned','project:project','add_project']);
  assert.equal(choices[0].label.label,'Back');
});

test('undiscovered managed paths never become UUID labels',()=>{
  const tree={id:'unknown',path:'/main/.sailry/worktrees/38e3dd37-9325-418f-9bbc-692cf9fac0d2',main:false};
  const choices=menu(location,{...catalog,worktrees:[...catalog.worktrees,tree]},entries,text);
  assert.equal(choices.some(choice=>choice.id==='worktree:unknown'),false);
  assert.equal(choices.some(choice=>choice.label.label.includes('38e3dd37')),false);
});
