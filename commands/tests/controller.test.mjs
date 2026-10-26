import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {selection} from '../dev.sailry.platform/desktop/access.js';

const shell = (id = 'shell') => ({id, revision:1, tool:null, ssh:null, status:{kind:'stopped'}});

async function fixture(items = [shell()], resource = {kind:'terminal', id:items[0]?.id}, initialEntry = 0) {
  const context = vm.createContext({});
  const prepared = [], completed = [], forgotten = [], panes = [], updates = [], notices = [], closed = [], released = [], requests = new Map();
  const host = {items, complete:null, prepareError:null, change:null};
  const prepare = (action, target) => {
    const id = `request-${prepared.length}`;
    const request = {id, action, target};
    prepared.push(request); requests.set(id, request); return id;
  };
  const exports = {
    'gpui-kit':{View:class {}},
    sailry:{context:() => JSON.stringify({locale:'en'}),releaseTerminal:id=>released.push(id)},
    'sailry/sdk':{
      listTerminals:async () => host.items,
      listTerminalTools:async () => [],
      prepareTerminal:(target,access) => { const id = prepare('create', target); requests.get(id).access = access; return id; },
      prepareOpenTerminal:target => { if (host.prepareError) throw host.prepareError; return prepare('open', target); },
      prepareCloseTerminal:target => prepare('close', target),
      completeRequest:async id => {
        completed.push(id);
        const request = requests.get(id);
        if (host.complete) return host.complete(request);
        host.items = host.items.map(item => item.id === request.target
          ? {...item, revision:item.revision + 1, status:{kind:'running'}} : item);
        return {Ok:{kind:'terminal', data:{id:request.target}}};
      },
      forgetRequest:id => forgotten.push(id),
      nextChange:() => new Promise(resolve => { host.change = resolve; }),
    },
    'sailry/ui':{nextMenuEvent() {}, pane:() => resource ? {resource} : null,
      openPane:value => { panes.push(value); return true; }, updatePane:value => updates.push(value),
      closePane:() => closed.push(true), nextPaneEvent() {},toast:value=>notices.push(value)},
    './locales.js':{messages:() => ({terminal:'Terminal', tools:{},failed:'Terminal action failed',unknown:'Outcome unknown',loadFailed:'Could not load terminals'})},
    './view.js':{render() {}},
    './labels.js':{title:() => null, directory:() => null},
    './access.js':{selection},
  };
  const module = new vm.SourceTextModule(await readFile(new URL('../dev.sailry.platform/desktop/main.js', import.meta.url), 'utf8'), {context});
  await module.link(name => new vm.SyntheticModule(Object.keys(exports[name]), function() {
    for (const [key, value] of Object.entries(exports[name])) this.setExport(key, value);
  }, {context}));
  await module.evaluate();
  const view = new module.namespace.default();
  const background = [];
  view.init(null, {spawn(callback) { background.push(callback); }});
  const pending = [];
  const cx = {notify() {}, spawn(callback) { pending.push(Promise.resolve().then(() => callback(cx))); }};
  let cursor = 0;
  const settle = async () => { while (cursor < pending.length) await pending[cursor++]; };
  background.at(-1)(cx);
  let changes = 0, entry = initialEntry;
  const observe = async () => {
    while (!host.change) await Promise.resolve();
    const receive = host.change; host.change = null;
    receive({cursor:String(++changes), connected:true, entry:String(entry)});
    while (!host.change) await Promise.resolve();
    await settle();
  };
  const enter = async () => { entry++; await observe(); };
  await observe();
  return {view, host, cx, settle, observe, enter, prepared, completed, forgotten, panes, updates,notices,closed,released};
}

test('restored shell metadata never launches a hidden process', async () => {
  const setup = await fixture();
  assert.equal(setup.view.loaded,true);
  setup.view.refresh(setup.cx); setup.view.refresh(setup.cx); await setup.settle();
  await setup.observe();
  assert.equal(setup.prepared.length, 0);
  assert.equal(setup.view.selected, 'shell');
  assert.equal(setup.view.items[0].status.kind, 'stopped');
  assert.equal(setup.panes.length, 0);
});

test('explicit entry reopens the captured shell once with its existing identity', async () => {
  const setup = await fixture();
  await setup.enter();
  assert.deepEqual(setup.prepared, [{id:'request-0', action:'open', target:'shell'}]);
  assert.equal(setup.view.selected, 'shell');
  assert.equal(setup.view.items[0].status.kind, 'running');
  assert.equal(setup.view.pending, null);
  assert.equal(setup.panes.length, 0);
  assert.deepEqual(setup.forgotten, ['request-0']);
  setup.view.refresh(setup.cx); setup.view.refresh(setup.cx); await setup.settle();
  assert.equal(setup.prepared.length, 1);
});

test('opens selected ordinary shells without replaying CLI or SSH launches', async () => {
  for (const item of [
    {...shell(), tool:'claude'}, {...shell(), ssh:'saved-host'},
    {...shell(), status:{kind:'exited', data:{code:0}}}, {...shell(), status:{kind:'running'}},
  ]) {
    const setup = await fixture([item]);
    await setup.enter();
    assert.equal(setup.prepared.length, 0);
  }
  const setup = await fixture([shell('first'), shell('second')], null);
  setup.view.selected = 'second';
  await setup.enter();
  assert.deepEqual(setup.prepared.map(request => request.target), ['second']);
  assert.equal(setup.view.items[0].status.kind, 'stopped');
});

test('selecting a stopped shell tab opens it without creating another pane', async () => {
  const setup = await fixture([{...shell('first'), status:{kind:'running'}}, shell('second')], null);
  setup.view.selected = 'first';
  setup.view.refresh(setup.cx); await setup.settle();
  setup.view.select(1, setup.cx); await setup.settle();
  assert.equal(setup.view.selected, 'second');
  assert.deepEqual(setup.prepared.map(request => request.target), ['second']);
  assert.equal(setup.panes.length, 0);
});

test('confirmed open failure requires an explicit retry with a new request', async () => {
  const setup = await fixture();
  setup.host.complete = async () => ({Err:{code:'busy'}});
  await setup.enter();
  assert.equal(setup.view.error, 'failed');
  assert.equal(setup.notices.length,1);assert.equal(setup.notices[0].message,'Terminal action failed');
  assert.equal(setup.view.openRetry, 'shell');
  setup.view.refresh(setup.cx); await setup.settle();
  assert.equal(setup.prepared.length, 1);
  setup.host.complete = null;
  setup.view.retry(setup.cx); await setup.settle();
  assert.deepEqual(setup.prepared.map(request => [request.id, request.target]),
    [['request-0', 'shell'], ['request-1', 'shell']]);
  assert.equal(setup.view.items[0].status.kind, 'running');
  assert.equal(setup.view.error, null);
});

test('uncertain open retains the original request and never retries automatically', async () => {
  for (const failure of [async () => ({Err:{code:'outcome_unknown'}}), async () => { throw new Error('disconnected'); }]) {
    const setup = await fixture(); setup.host.complete = failure;
    await setup.enter();
    assert.equal(setup.view.error, 'unknown');
    assert.equal(setup.view.pending.id, 'request-0');
    assert.equal(setup.forgotten.length, 0);
    setup.view.refresh(setup.cx); await setup.settle();
    assert.deepEqual(setup.completed, ['request-0']);
    setup.host.complete = null;
    setup.view.retry(setup.cx); await setup.settle();
    assert.equal(setup.prepared.length, 1);
    assert.deepEqual(setup.completed, ['request-0', 'request-0']);
    assert.deepEqual(setup.forgotten, ['request-0']);
    assert.equal(setup.view.pending, null);
  }
});

test('a completed open does not replace a subsequently selected tab', async () => {
  const setup = await fixture([shell('first'), shell('second')], null);
  setup.view.selected = 'first';
  let release;
  setup.host.complete = request => new Promise(resolve => { release = () => {
    setup.host.items = setup.host.items.map(item => item.id === request.target
      ? {...item, status:{kind:'running'}} : item);
    resolve({Ok:{kind:'terminal', data:{id:request.target}}});
  }; });
  const entering = setup.enter();
  while (!release) await Promise.resolve();
  setup.view.select(1, setup.cx);
  setup.host.complete = null; release(); await entering; await setup.settle();
  assert.equal(setup.view.selected, 'second');
  assert.deepEqual(setup.prepared.map(request => request.target), ['first', 'second']);
  assert.equal(setup.panes.length, 0);
});

test('stopped revisions remain stopped until another explicit entry', async () => {
  const setup = await fixture();
  await setup.enter();
  setup.host.items = setup.host.items.map(item => ({...item, revision:item.revision + 1, status:{kind:'stopped'}}));
  setup.view.refresh(setup.cx); setup.view.refresh(setup.cx); await setup.settle();
  await setup.observe();
  assert.equal(setup.prepared.length, 1);
  assert.equal(setup.view.items[0].status.kind, 'stopped');
  await setup.enter();
  assert.deepEqual(setup.prepared.map(request => [request.id, request.target]),
    [['request-0', 'shell'], ['request-1', 'shell']]);
  assert.equal(setup.view.items.length, 1);
  assert.equal(setup.view.items[0].status.kind, 'running');
  setup.view.refresh(setup.cx); await setup.settle();
  assert.equal(setup.prepared.length, 2);
});

test('switching after failure opens another shell and preserves revision-specific retry', async () => {
  const setup = await fixture([shell('first'), shell('second')], null);
  setup.view.selected = 'first';
  setup.host.complete = async () => ({Err:{code:'busy'}});
  await setup.enter();
  assert.equal(setup.view.openRetry, 'first');
  setup.host.complete = null;
  setup.view.select(1, setup.cx); await setup.settle();
  assert.equal(setup.view.selected, 'second');
  assert.equal(setup.view.error, null);
  assert.deepEqual(setup.prepared.map(request => request.target), ['first', 'second']);
  setup.view.select(0, setup.cx); await setup.settle();
  assert.equal(setup.view.error, 'failed');
  assert.equal(setup.view.openRetry, 'first');
  assert.equal(setup.prepared.length, 2);
  setup.view.retry(setup.cx); await setup.settle();
  assert.deepEqual(setup.prepared.map(request => request.target), ['first', 'second', 'first']);
  assert.equal(setup.view.items[0].status.kind, 'running');
});

test('switching shells does not clear unrelated load or action failures', async () => {
  for (const error of ['loadFailed', 'failed']) {
    const setup = await fixture([shell('first'), shell('second')], null);
    setup.view.items = setup.host.items; setup.view.selected = 'first'; setup.view.error = error;
    setup.view.select(1, setup.cx); await setup.settle();
    assert.equal(setup.view.error, error);
    assert.equal(setup.prepared.length, 0);
  }
});

test('a preparation failure retains the open target for an explicit retry', async () => {
  const setup = await fixture(); setup.host.prepareError = new Error('draft capacity exhausted');
  await setup.enter();
  assert.equal(setup.view.error, 'failed');
  assert.equal(setup.view.openRetry, 'shell');
  assert.equal(setup.view.pending, null);
  assert.equal(setup.prepared.length, 0);
  assert.equal(setup.completed.length, 0);
  setup.host.prepareError = null;
  setup.view.refresh(setup.cx); await setup.settle();
  assert.equal(setup.prepared.length, 0);
  setup.view.retry(setup.cx); await setup.settle();
  assert.deepEqual(setup.prepared, [{id:'request-0', action:'open', target:'shell'}]);
  assert.equal(setup.view.items[0].status.kind, 'running');
});

test('uncertain opens keep panes busy and reject actions until explicit retry', async () => {
  const setup = await fixture(); setup.host.complete = async () => ({Err:{code:'outcome_unknown'}});
  await setup.enter();
  assert.equal(setup.view.busy, false);
  assert.equal(setup.updates.filter(update => Object.hasOwn(update, 'busy')).at(-1).busy, true);
  for (const action of ['close', 'create', 'open']) setup.view.perform(action, 'shell', setup.cx);
  await setup.settle();
  assert.deepEqual(setup.completed, ['request-0']);
  assert.equal(setup.prepared.length, 1);
  assert.equal(setup.view.pending.id, 'request-0');
  setup.host.complete = null;
  setup.view.retry(setup.cx); await setup.settle();
  assert.deepEqual(setup.completed, ['request-0', 'request-0']);
  assert.equal(setup.prepared.length, 1);
  assert.equal(setup.updates.filter(update => Object.hasOwn(update, 'busy')).at(-1).busy, false);
});

test('an initial explicit entry waits for the captured terminal inventory', async () => {
  const setup = await fixture([shell()], {kind:'terminal', id:'shell'}, 1);
  assert.deepEqual(setup.prepared, [{id:'request-0', action:'open', target:'shell'}]);
  assert.equal(setup.view.selected, 'shell');
  assert.equal(setup.view.items[0].status.kind, 'running');
});

test('entering a running shell never authorizes a later background restart', async () => {
  const setup = await fixture([{...shell(), status:{kind:'running'}}]);
  await setup.enter();
  setup.host.items = [shell()];
  await setup.observe();
  assert.equal(setup.prepared.length, 0);
  assert.equal(setup.view.items[0].status.kind, 'stopped');
  await setup.enter();
  assert.equal(setup.prepared.length, 1);
});

test('a removed selection never transfers its opening intent to another shell', async () => {
  const setup = await fixture([shell('first'), shell('second')], null);
  let release;
  setup.host.complete = request => new Promise(resolve => { release = () => {
    setup.host.items = [{...shell('first'), revision:2}];
    resolve({Ok:{kind:'terminal', data:{id:request.target}}});
  }; });
  const entering = setup.enter();
  while (!release) await Promise.resolve();
  setup.view.select(1, setup.cx);
  setup.host.complete = null; release(); await entering; await setup.settle();
  assert.equal(setup.view.selected, 'first');
  assert.equal(setup.view.items[0].status.kind, 'stopped');
  assert.deepEqual(setup.prepared.map(request => request.target), ['first']);
});


test('new terminals default to full and retain workspace retries', async () => {
  const setup = await fixture([],null);
  setup.view.perform('create', null, setup.cx); await setup.settle();
  assert.equal(setup.prepared[0].access,'unrestricted');
  setup.host.complete = async () => ({Err:{code:'outcome_unknown'}});
  setup.view.perform('create','claude:workspace',setup.cx); await setup.settle();
  assert.deepEqual(setup.prepared[1],{id:'request-1',action:'create',target:'claude',access:'workspace'});
  setup.view.perform('create',null,setup.cx); await setup.settle();
  assert.equal(setup.prepared.length,2);
  setup.host.complete = async () => ({Ok:{kind:'terminal',data:{id:'workspace'}}});
  setup.view.retry(setup.cx); await setup.settle();
  assert.equal(setup.prepared.length,2);
  assert.deepEqual(setup.completed,['request-0','request-1','request-1']);
  assert.equal(setup.view.pending,null);
});


test('a missing resource closes after authoritative inventory loads', async () => {
  const setup = await fixture([], {kind:'terminal',id:'missing'});
  assert.equal(setup.view.loaded,true);
  assert.deepEqual(setup.closed,[true]);
  assert.deepEqual(setup.prepared,[]);
  assert.deepEqual(setup.notices,[]);
});

test('terminal release precedes close dispatch and inventory removal', async () => {
  const item={...shell(),status:{kind:'running'}},setup=await fixture([item],null);
  setup.host.complete=async request=>{
    assert.deepEqual(setup.released,[item.id]);
    assert.equal(setup.view.closingTerminals.has(item.id),true);
    setup.host.items=[];
    return {Ok:{kind:'terminal',data:{...item,status:{kind:'closed'}}}};
  };
  setup.view.perform('close',item.id,setup.cx);await setup.settle();
  assert.equal(setup.view.closingTerminals.size,0);assert.equal(setup.view.selected,null);
  assert.deepEqual(setup.completed,['request-0']);assert.equal(setup.prepared.length,1);
  assert.deepEqual(setup.notices,[]);
});

test('confirmed close failure restores the current terminal without replay', async () => {
  const item={...shell(),status:{kind:'running'}},setup=await fixture([item],null);
  setup.host.complete=async()=>({Err:{code:'busy'}});
  setup.view.perform('close',item.id,setup.cx);await setup.settle();
  assert.deepEqual(setup.released,[item.id]);assert.equal(setup.view.closingTerminals.size,0);
  assert.equal(setup.view.items[0],item);assert.equal(setup.view.selected,item.id);
  assert.equal(setup.view.error,'failed');assert.equal(setup.view.pending,null);
  assert.equal(setup.prepared.length,1);assert.deepEqual(setup.completed,['request-0']);
});

test('uncertain close retains release and the original request identity', async () => {
  for(const failed of [false,true]){
    const item={...shell(),status:{kind:'running'}},setup=await fixture([item],null);
    setup.host.complete=async()=>({Err:{code:'outcome_unknown'}});
    setup.view.perform('close',item.id,setup.cx);await setup.settle();
    assert.equal(setup.view.closingTerminals.has(item.id),true);
    assert.equal(setup.view.pending.id,'request-0');assert.equal(setup.view.error,'unknown');
    setup.view.refresh(setup.cx);await setup.settle();
    assert.deepEqual(setup.completed,['request-0']);
    setup.host.complete=async()=>{
      if(failed)return {Err:{code:'busy'}};
      setup.host.items=[];return {Ok:{kind:'terminal',data:{...item,status:{kind:'closed'}}}};
    };
    setup.view.retry(setup.cx);await setup.settle();
    assert.equal(setup.view.closingTerminals.size,0);assert.equal(setup.view.pending,null);
    assert.equal(setup.view.selected,failed?item.id:null);
    assert.deepEqual(setup.released,[item.id]);assert.equal(setup.prepared.length,1);
    assert.deepEqual(setup.completed,['request-0','request-0']);
  }
});
