import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {Menus} from '../dev.sailry.platform/desktop/menus.js';
import {messages} from '../dev.sailry.platform/desktop/locales.js';

const source=readFileSync(new URL('../dev.sailry.platform/desktop/context.js',import.meta.url),'utf8')
  .replace(/^import[\s\S]*?;\n/gm,'').replace('export default class Context','class Context');

function fixture() {
  const published=[],invoked=[];
  const location={cursor:'1',node:'node',project:'project',worktree:'tree',surface:'composer',
    branch:'main',main:true,connected:true,can_move:true,git_status:'repository'};
  const repo={connected:true,loading:false,status:{index_revision:'index'},refresh:async()=>true,
    writable:()=>!repo.loading,branches:{current:'main',entries:[
      {name:'main',commit:'main-commit',current:true,remote:false},
      {name:'feature',commit:'feature-commit',current:false,remote:false},
      {name:'origin/remote',commit:'remote-commit',current:false,remote:true},
    ],sync:{tracking:{},remotes:['origin']}}};
  const Git=class {
    init() {
      this.text=messages('en');this.repo=repo;this.notify=()=>{};
      this.menus=new Menus(this);
      this.actions={invoke:async value=>invoked.push(value)};
    }
  };
  const Context=vm.runInNewContext(`${source}\nContext`,{
    Git,readLocation:()=>location,readScope:()=>({worktree:'tree'}),
    publishContributions:states=>published.push(states),
  });
  const view=new Context();
  view.init({}, {spawn(){}});
  return {view,repo,published,invoked};
}

test('branch contribution uses a popup in every repository worktree',()=>{
  const manifest=JSON.parse(readFileSync(new URL('../plugin.json',import.meta.url),'utf8'));
  assert.equal(manifest.extensions['dev.sailry.platform'].ui.find(entry=>entry.id==='branch').kind,'popover');
  const {view,published}=fixture();
  view.location={...view.location,main:false};
  view.publish();
  const branch=published.at(-1).find(entry=>entry.id==='branch');
  assert.equal(branch.visible,true);
  assert.equal(branch.value,false);
  assert.equal(branch.label.label,'main');
});

test('branch choices retain names groups and current selection',()=>{
  const {view}=fixture();
  const choices=view.branchChoices();
  assert.deepEqual(choices.slice(0,3).map(choice=>choice.label),['main','feature','origin/remote']);
  assert.deepEqual(choices.slice(0,3).map(choice=>choice.checked),[true,false,false]);
  assert.equal(choices[0].group,choices[1].group);
  assert.notEqual(choices[1].group,choices[2].group);
});

test('opening exposes retained choices while refreshing',async()=>{
  const {view,repo,published}=fixture();
  let finish;
  repo.refresh=()=>new Promise(resolve=>{finish=resolve;});
  const task=view.openBranches(true);
  assert.equal(view.menuOpen,true);
  assert.equal(published.at(-1)[0].value,true);
  assert.equal(view.branchChoices()[0].label,'main');
  await view.openBranches(false);
  finish(true);await task;
  assert.equal(view.menuOpen,false);
  assert.equal(published.at(-1)[0].value,false);
});

test('branch selection reuses actions and closes the popup',async()=>{
  const {view,invoked,published}=fixture();
  view.menuOpen=true;
  const choice=view.branchChoices().find(choice=>choice.label==='feature');
  await view.selectBranch(choice);
  assert.deepEqual(invoked,[choice.value]);
  assert.equal(view.menuOpen,false);
  assert.equal(published.at(-1)[0].value,false);
});

test('nested branch operations stay in the popup with back',async()=>{
  const {view,invoked}=fixture();
  view.menuOpen=true;
  const choice=view.branchChoices().find(choice=>choice.value.kind==='choose' && choice.value.title==='git_branch_from');
  await view.selectBranch(choice);
  assert.equal(view.menuOpen,true);
  assert.equal(view.branchPath.length,1);
  assert.equal(view.branchChoices(),choice.value.items);
  assert.deepEqual(invoked,[]);
  view.back();
  assert.equal(view.branchPath.length,0);
  assert.ok(view.branchChoices().some(choice=>choice.value.kind==='form'));
});

test('creation opens the existing form after closing',async()=>{
  const {view,invoked}=fixture();
  view.menuOpen=true;
  const choice=view.branchChoices().find(choice=>choice.value.kind==='form');
  await view.selectBranch(choice);
  assert.equal(view.menuOpen,false);
  assert.deepEqual(invoked,[{kind:'form',form:'branch'}]);
});

test('uncaptured or busy checkouts cannot run branch actions',async()=>{
  for(const state of ['scope','busy','movement']) {
    const {view,repo,invoked}=fixture();
    const choice=view.branchChoices()[1];
    if(state==='scope')view.location={...view.location,worktree:'other'};
    if(state==='busy')repo.loading=true;
    if(state==='movement')view.location={...view.location,can_move:false};
    await view.selectBranch(choice);
    assert.deepEqual(invoked,[]);
  }
});
