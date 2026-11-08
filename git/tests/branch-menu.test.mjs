import test,{describe} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {Menus} from '../dev.sailry.platform/desktop/menus.js';
import {messages} from '../dev.sailry.platform/desktop/locales.js';
import * as policy from '../dev.sailry.platform/desktop/session-branch.js';

const source=readFileSync(new URL('../dev.sailry.platform/desktop/context.js',import.meta.url),'utf8')
  .replace(/^import[\s\S]*?;\n/gm,'').replace('export default class Context','class Context');
const commit=letter=>letter.repeat(40);
const branches=[
  {name:'main',commit:commit('a'),current:true,remote:false},
  {name:'dev',commit:commit('b'),current:false,remote:false},
  {name:'topic',commit:commit('c'),current:false,remote:false},
  {name:'origin/main',commit:commit('d'),current:false,remote:true},
];

function fixture(patch={}) {
  const published=[],selected=[],invoked=[],copied=[],forms=[],reported=[];
  const location={cursor:'1',node:'node',project:'project',worktree:'tree',surface:'composer',session:null,
    branch:'main',main:true,connected:true,can_move:true,git_status:'repository',...patch};
  const repo={connected:true,loading:false,status:{index_revision:'index',head:commit('a')},refresh:async()=>true,
    invalidate:async()=>true,writable:()=>!repo.loading,branches:{current:'main',entries:branches,sync:{tracking:{},remotes:['origin']}}};
  const Git=class {
    init() {
      this.text=messages('en');this.repo=repo;this.notify=()=>{};this.worktrees=true;
      this.menus=new Menus(this);
      this.actions={form:form=>forms.push(form)};
    }
    run() {}
    report(key) { reported.push(key); }
  };
  const Context=vm.runInNewContext(`${source}\nContext`,{
    Git,...policy,readLocation:()=>location,readScope:()=>({worktree:'tree'}),newId:()=>'1a2b3c4d-0000',
    publishContributions:states=>published.push(states),
    selectLocation:async(cursor,value)=>{selected.push({cursor,value});return true;},
    invokeContribution:async(intent,value)=>{invoked.push({intent,value});return true;},
    writeClipboard:text=>copied.push(text),inspectGit:async()=>({head:commit('a')}),
  });
  const view=new Context();
  view.init({}, {spawn(){}});
  view.checkouts=new Map([['topic','topic-tree']]);
  view.publish();
  return {view,published,selected,invoked,copied,forms,reported};
}
const plain=value=>JSON.parse(JSON.stringify(value));
const chip=published=>published.at(-1).find(entry=>entry.id==='branch');

test('the branch chip publishes Kit menu choices',()=>{
  const manifest=JSON.parse(readFileSync(new URL('../plugin.json',import.meta.url),'utf8'));
  const entry=manifest.extensions['dev.sailry.platform'].ui.find(entry=>entry.id==='branch');
  assert.equal(entry.kind,'menu');
  assert.equal(entry.intent,undefined);
  const {published}=fixture();
  const branch=chip(published);
  assert.equal(branch.visible,true);
  assert.equal(branch.label.label,'main');
  assert.equal(branch.value,'branch:main');
});

describe('new conversations',()=>{
  test('list local branches, a remote submenu and the start action',()=>{
    const {published}=fixture();
    const {choices}=chip(published);
    assert.deepEqual(choices.map(choice=>choice.id),['branch:main','branch:dev','branch:topic','remote','start']);
    assert.deepEqual(choices.slice(0,3).map(choice=>choice.description?.label),['Current',undefined,'Worktree']);
    assert.deepEqual(choices.slice(0,3).map(choice=>choice.icon),[undefined,undefined,undefined]);
    assert.deepEqual(choices[3].children.map(choice=>choice.id),['remote:origin/main']);
    assert.equal(choices[3].label.label,'Remote branches');
    assert.equal(choices[4].icon,'plus');
    assert.equal(choices[4].label.label,'Start from new branch…');
    assert.deepEqual(choices[0].group,choices[2].group);
    assert.notDeepEqual(choices[2].group,choices[3].group);
    assert.notDeepEqual(choices[3].group,choices[4].group);
  });

  test('another branch becomes a pending worktree base',async()=>{
    const {view,selected}=fixture();
    await view.choose('branch:dev');
    await view.choose('remote:origin/main');
    assert.deepEqual(plain(selected).map(entry=>entry.value),[
      {base:{from:'dev',branch:'sailry/1a2b3c4d',commit:commit('b')}},
      {base:{from:'origin/main',branch:'sailry/1a2b3c4d',commit:commit('d')}},
    ]);
  });

  test('a pending base labels and checks the chosen branch',()=>{
    const {published}=fixture({base:{from:'dev',branch:'sailry/1a2b3c4d',commit:commit('b')}});
    assert.equal(chip(published).label.label,'dev · New worktree');
    assert.equal(chip(published).value,'branch:dev');
    const remote=fixture({base:{from:'origin/main',branch:'sailry/x',commit:commit('d')}});
    assert.equal(chip(remote.published).value,'remote:origin/main');
  });

  test('the current branch stays in the bound checkout',async()=>{
    const idle=fixture();
    await idle.view.choose('branch:main');
    assert.deepEqual(idle.selected,[]);
    const pending=fixture({base:{from:'dev',branch:'sailry/x',commit:commit('b')}});
    await pending.view.choose('branch:main');
    assert.deepEqual(plain(pending.selected).map(entry=>entry.value),[{worktree:'tree'}]);
  });

  test('branches in another worktree select that worktree',async()=>{
    const {view,selected}=fixture();
    await view.choose('branch:topic');
    assert.deepEqual(plain(selected).map(entry=>entry.value),[{worktree:'topic-tree'}]);
  });

  test('a named branch starts from the bound head',async()=>{
    const {view,selected,forms}=fixture();
    await view.choose('start');
    assert.deepEqual(forms,['start']);
    await view.startBranch('feature/new');
    assert.deepEqual(plain(selected).map(entry=>entry.value),[{base:{from:'feature/new',branch:'feature/new',commit:commit('a')}}]);
  });

  test('unknown or stale rows never switch branches',async()=>{
    const {view,selected,reported}=fixture();
    for (const id of ['branch:missing','remote:dev','fork:dev','copy']) await view.choose(id);
    assert.deepEqual(selected,[]);
    assert.deepEqual(reported,['git_branch_revision','git_branch_revision','git_branch_revision','git_branch_revision']);
  });
});

describe('running conversations',()=>{
  test('offer copy and a fork submenu',()=>{
    const {published}=fixture({session:'session'});
    const {choices,value}=chip(published);
    assert.equal(value,null);
    assert.deepEqual(choices.map(choice=>choice.id),['copy','fork']);
    assert.deepEqual(choices[1].children.map(choice=>choice.id),['fork:main','fork:dev','fork:topic','fork:origin/main']);
    assert.equal(choices[1].label.label,'Fork from another branch…');
  });

  test('copy and fork reuse clipboard and the worktree fork flow',async()=>{
    const {view,copied,invoked,selected}=fixture({session:'session'});
    await view.choose('copy');
    await view.choose('fork:origin/main');
    await view.choose('branch:dev');
    assert.deepEqual(plain(copied),['main']);
    assert.deepEqual(plain(invoked),[{intent:'fork_worktree',value:{base:{from:'origin/main',commit:commit('d')}}}]);
    assert.deepEqual(selected,[]);
  });
});

test('menus stay inside contribution limits',()=>{
  const many=Array.from({length:300},(_,index)=>({name:`branch-${index}`,commit:commit('e'),remote:index%2===1}));
  const menu=policy.branchMenu({session:null,branch:'branch-298'},many,new Map(),messages('en'),true);
  const count=menu.choices.reduce((total,choice)=>total+1+(choice.children?.length ?? 0),0);
  assert.ok(count<=256);
  assert.ok(menu.choices.some(choice=>choice.id==='branch:branch-298'));
  assert.ok(new TextEncoder().encode(policy.fit('分'.repeat(60))).length<=128);
});

test('checkouts map other registered worktrees by branch',()=>{
  const found=policy.checkouts({worktrees:[{id:'tree',path:'/main'},{id:'other',path:'/other'},{id:'gone',path:'/gone'}]},
    [{path:'/main',branch:'main'},{path:'/other',branch:'topic'},{path:'/gone',branch:'old',available:false}],'tree');
  assert.deepEqual([...found],[['topic','other']]);
});

