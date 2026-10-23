import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

async function fixture(packageName,overrides={}) {
  const source=(await readFile(new URL(`../../${packageName}/dev.sailry.platform/desktop/main.js`,import.meta.url),'utf8'))
    .replace(/^import[\s\S]*?;\n/gm,'').replace('export default class','class');
  const jobs=[],notices=[];
  let batch={items:[],after:null},failure=null,waiting=null;
  const read=async()=>{
    if(waiting)await waiting;
    if(failure)throw new Error('Injected read failure');
    return batch;
  };
  const name=packageName==='reminders'?'Reminders':'ScheduledTasks';
  const Controller=vm.runInNewContext(`${source}\n${name}`,{
    View:class{},context:()=>JSON.stringify({locale:'en'}),messages:()=>new Proxy({},{get:(_,key)=>key}),
    list:async()=>({Ok:await read()}),page:read,
    history:async()=>({Ok:{items:[],next_before:null}}),states:async()=>({}),
    readProjectCatalog:async()=>({projects:[{id:'project',name:'Project'}],worktrees:[]}),
    listModels:async()=>({models:[]}),toast:notice=>notices.push(notice),
    ...overrides,
  });
  const view=new Controller(),cx={notify(){},spawn:job=>jobs.push(job)};
  view.init(null,cx);jobs.length=0;
  return {view,cx,notices,
    hold(){let release;waiting=new Promise(resolve=>{release=resolve;});return()=>{waiting=null;release();};},
    succeed(items){batch={items,after:null};failure=null;},
    fail(){failure=true;},
    async read(){view.refresh(cx);return jobs.shift()(cx);},
  };
}

for(const packageName of ['scheduled-tasks','reminders']) {
  test(`${packageName} starts independent page reads before settling`,async()=>{
    const calls=[],held=[];
    const hold=(kind,value)=>()=>{calls.push(kind);return new Promise(resolve=>held.push(()=>resolve(value)));};
    const overrides={page:hold('records',{items:[{id:'saved'}],after:null}),list:hold('records',{Ok:{items:[{id:'saved'}],after:null}}),
      history:hold('history',{Ok:{items:[],next_before:null}}),states:hold('states',{}),
      readProjectCatalog:hold('projects',{projects:[],worktrees:[]}),listModels:hold('models',{models:[]})};
    const setup=await fixture(packageName,overrides);
    setup.view.panel=packageName==='reminders'?{reminder:'saved'}:{task:'saved'};
    const loading=setup.read();
    assert.deepEqual(calls,packageName==='reminders'?['records','history','projects']:['records','history','states','projects','models']);
    assert.equal(setup.view.loaded,false);assert.equal(setup.view.loading,true);
    held.forEach(resolve=>resolve());await loading;
    assert.equal(setup.view.loaded,true);assert.equal(setup.view.items[0].id,'saved');
    assert.equal(setup.view.historyLoaded,true);assert.deepEqual(setup.notices,[]);
  });

  test(`${packageName} confirms absence only after the initial read`,async()=>{
    const setup=await fixture(packageName),release=setup.hold();
    assert.equal(setup.view.loaded,false);assert.equal(setup.view.loading,false);
    const pending=setup.read();
    assert.equal(setup.view.loaded,false);assert.equal(setup.view.loading,true);
    release();await pending;
    assert.equal(setup.view.loaded,true);assert.equal(setup.view.loading,false);
    assert.equal(setup.view.items.length,0);assert.equal(setup.notices.length,0);
  });

  test(`${packageName} retains cards and drafts during a failed refresh`,async()=>{
    const setup=await fixture(packageName),item={id:'saved',title:'Reminder',name:'Task',due_ms:null};
    setup.succeed([item]);await setup.read();
    const items=setup.view.items,catalog=setup.view.catalog,draft={text:'Retained edit'};
    setup.view.editing={draft};
    const release=setup.hold();setup.fail();const pending=setup.read();
    assert.equal(setup.view.items,items);assert.equal(setup.view.loaded,true);
    assert.equal(setup.view.editing.draft,draft);
    release();await pending;
    assert.equal(setup.view.loading,false);assert.equal(setup.view.loaded,true);
    assert.equal(setup.view.items,items);assert.equal(setup.view.catalog,catalog);
    assert.equal(setup.view.editing.draft,draft);assert.equal(setup.view.error,'loadFailed');
    assert.equal(setup.notices.length,1);assert.equal(setup.notices[0].kind,'error');
    setup.succeed([]);await setup.read();
    assert.equal(setup.view.loaded,true);assert.equal(setup.view.items.length,0);
    assert.equal(setup.view.error,null);assert.equal(setup.view.editing.draft,draft);
  });

  test(`${packageName} does not confirm absence after a failed initial read`,async()=>{
    const setup=await fixture(packageName);setup.fail();await setup.read();
    assert.equal(setup.view.loaded,false);assert.equal(setup.view.loading,false);
    assert.equal(setup.view.error,'loadFailed');assert.equal(setup.notices.length,1);
  });
}
