import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {State,RANGES,DIMENSIONS,query,choices} from '../dev.sailry.platform/desktop/state.js';
import {messages} from '../dev.sailry.platform/desktop/locales.js';
import {compact,grouped,duration} from '../dev.sailry.platform/desktop/format.js';
import {formatRows} from '../dev.sailry.platform/desktop/requests.js';
import {breakdown,VISIBLE} from '../dev.sailry.platform/desktop/breakdown.js';
import {percent} from '../dev.sailry.platform/desktop/summary.js';

const source = (await readFile(new URL('../dev.sailry.platform/desktop/settings.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '').replace('export default class Usage', 'class Usage');
const plain = value => JSON.parse(JSON.stringify(value));
const node = '01'.repeat(32), remote = '02'.repeat(32);
test('shared timing format preserves request display units',()=>{
  const text=messages('en');
  assert.equal(duration(null,text),text.composer_metric_unknown);
  assert.equal(duration('1250',text),'1.3 ms');
  assert.equal(duration('1000000',text),'1.00 s');
});

function fixture() {
  const tasks = [], events = [], calls = [], notices=[],cx = {spawn:task => tasks.push(task), notify() {}};
  const {Usage} = vm.runInNewContext(`${source}\n({Usage})`, {
    View:class {}, context:() => JSON.stringify({node,locale:'en'}), State, RANGES, query, choices, messages,
    nextTableEvent:async () => { throw new Error('closed'); },
    header_action:async () => { if (!events.length) throw new Error('closed'); return events.shift(); },
    selectHost:() => assert.fail('Usage filters must not navigate'),
    watchUsage:(query,all,target=node) => calls.push(['watch',plain(query),all,target]),
    nextUsageChange:async () => { throw new Error('closed'); },
    refreshUsage:() => calls.push(['refresh']),
    toast:value=>notices.push(value),
  });
  const view = new Usage();
  view.init({},cx);
  const header = tasks.at(-1);
  return {view,cx,calls,tasks,events,notices,header:() => header(cx),
    select:(field,value,generation=view.state.generation) => events.push(JSON.stringify({id:`usage-filter-${field}`,value:`${generation}:${value}`}))};
}

test('declares one independent Host-owned workspace page', async () => {
  const manifest = JSON.parse(await readFile(new URL('../plugin.json', import.meta.url), 'utf8'));
  const extension = manifest.extensions['dev.sailry.platform'];
  assert.equal(extension.settings_page, undefined);
  assert.equal(extension.scope ?? 'host', 'host');
  assert.equal(extension.desktop.navigation_options.surface, 'workspace');
  assert.equal(extension.desktop.navigation_options.target ?? 'node', 'node');
  assert.deepEqual(extension.actions, ['usage.read','conversation.read']);
  assert.equal(extension.desktop.ui_shared, true);
  assert.equal(extension.api_version, 'v1');
});

test('uses the bound Shell host and rejects page-level host changes', async () => {
  const setup = fixture(), header = setup.view.header();
  assert.equal(header.title, 'Usage');
  assert.deepEqual(plain(header.filters.map(filter => filter.id)), ['usage-filter-range','usage-filter-project','usage-filter-provider','usage-filter-model']);
  setup.select('host',remote);
  setup.select('host','all');
  setup.select('provider','selected');
  setup.select('provider','stale',1);
  setup.select('project','project-a',2);
  await setup.header();
  const range = setup.view.header().filters[0];
  assert.equal(range.segmented, true);assert.equal(range.primary, true);
  assert.deepEqual(plain(range.items.map(item => item.label)), ['24 hours','7 days','30 days','90 days','1 year']);
  assert.equal(range.selected, `${setup.view.state.generation}:30d`);
  assert(setup.view.header().filters.slice(1).every(filter => !filter.segmented));
  assert.deepEqual(setup.calls.filter(call => call[0] === 'watch').map(call => call.slice(2)), [[false,node],[false,node],[false,node]]);
  assert.equal(setup.view.state.node, node);
  assert.deepEqual(setup.view.state.query.providers, []);
  assert.deepEqual(setup.view.state.query.projects, ['project-a']);
});

test('failed observers retain honest feedback and retry the current query', async () => {
  const setup = fixture();
  await setup.tasks[0](setup.cx);
  assert.equal(setup.view.error, 'usage_read_failed');
  assert.equal(setup.notices.length,1);assert.equal(setup.notices[0].kind,'error');
  setup.events.push('usage-refresh');
  await setup.header();
  assert.equal(setup.view.error, null);
  assert.equal(setup.view.state.generation, 2);
  assert.equal(setup.calls.filter(call => call[0] === 'watch').length, 2);
  assert.equal(setup.calls.some(call => call[0] === 'refresh'), false);
});

test('page title is published only through the shared Header', async () => {
  const viewSource = (await readFile(new URL('../dev.sailry.platform/desktop/view.js', import.meta.url), 'utf8'))
    .replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  const nodes = new Map();
  function element(kind='div',id=null,props={}) {
    const value = {kind,selector:id,props,items:[]};
    const proxy = new Proxy(value,{get(target,key) {
      if(key==='id')return id => {target.selector=id;nodes.set(id,proxy);return proxy;};
      if(key==='child')return child => {target.items.push(child);return proxy;};
      if(key==='children')return children => {target.items.push(...children);return proxy;};
      if(key in target)return target[key];
      return () => proxy;
    }});
    if(id)nodes.set(id,proxy);
    return proxy;
  }
  const {render} = vm.runInNewContext(`${viewSource}\n({render})`, {
    div:() => element(), Progress:function(id) {return element('Progress',id);},
    Header:{new:(id,props) => element('Header',id,props)},
    Loading:{new:(id,props) => element('Loading',id,props)},
    theme:() => ({colors:{muted_foreground:'muted'}}),
  });
  const {view} = fixture();
  render(view);
  assert.equal(nodes.get('usage-page').items[0].selector, 'usage-header');
  assert.equal(JSON.parse(nodes.get('usage-header').props.content).title, 'Usage');
  assert.equal(nodes.has('settings-header'), false);
  assert.equal(nodes.has('settings-heading'), false);
  assert.ok(nodes.has('usage-content'));
  assert.equal(nodes.get('usage-initial-loading').kind,'Loading');
});

function elements(extra={}) {
  const nodes=new Map();
  function element(kind='div',id=null,props={}) {
    const value={kind,selector:id,props,items:[],calls:{}};
    const proxy=new Proxy(value,{get(target,key) {
      if(key==='id')return id=>{target.selector=id;nodes.set(id,proxy);return proxy;};
      if(key==='child')return child=>{target.items.push(child);return proxy;};
      if(key==='children')return children=>{target.items.push(...children);return proxy;};
      if(key in target)return target[key];
      return (...args)=>{target.calls[key]=args;return proxy;};
    }});
    if(id)nodes.set(id,proxy);
    return proxy;
  }
  const adapters=Object.fromEntries(['SettingsGroup','DataTable','Loading','ProgressBar']
    .map(kind=>[kind,{new:(id,props)=>element(kind,id,props)}]));
  const constructors=Object.fromEntries(['Button','Tab','TabBar','Tag','Pagination','Progress']
    .map(kind=>[kind,function(id){return element(kind,id);}]));
  const context={div:()=>element(),theme:()=>({colors:{muted_foreground:'muted'}}),...adapters,...constructors,
    compact,grouped,percent,breakdown,VISIBLE,DIMENSIONS,formatRows,...extra};
  return {nodes,context};
}
const viewSource=async()=>(await readFile(new URL('../dev.sailry.platform/desktop/view.js',import.meta.url),'utf8'))
  .replace(/^import .*;\n/gm,'').replace(/^export /gm,'');

test('breakdown tables reuse one card and fold beyond six rows',async()=>{
  const {nodes,context}=elements(),groups=[];
  const {card,distribution}=vm.runInNewContext(`${await viewSource()}\n({card,distribution})`,context);
  const notices=[],view={text:messages('en'),state:new State(node),group:value=>notices.push(value)},data={node,groups,query:{dimension:'model'}};
  card('usage-breakdown-card',distribution(view,data));
  const group=nodes.get('usage-breakdown-card-box');
  assert.equal(group.kind,'SettingsGroup');assert.deepEqual(plain(group.props),{heading:false});
  let table=nodes.get('usage-breakdown');
  assert.equal(table.kind,'DataTable');assert.deepEqual(plain(table.props.rows),[]);
  assert.equal(table.props.empty,view.text.usage_empty);assert.equal(table.props.header_height,32);
  assert.deepEqual(plain(table.props.columns),['Name','Share','Tokens','Cache hits','Responses','Cost']);
  assert.equal(nodes.has('usage-breakdown-more'),false);
  const tabs=nodes.get('usage-breakdown-tabs');
  assert.equal(tabs.calls.selected_index[0],0);assert.equal(tabs.items.length,3);
  tabs.calls.on_change[0](2,{});assert.deepEqual(notices,['project']);
  for(let index=0;index<VISIBLE+1;index++)groups.push({key:{kind:'model',data:{model:`m${index}`,provider:'p'}},name:'Provider',
    metrics:{responses:'1',tokens:{input:String(10-index),output:'0',cached_input:'0',reasoning:'0'}}});
  nodes.clear();distribution(view,data);table=nodes.get('usage-breakdown');
  assert.equal(table.props.rows.length,VISIBLE);
  assert.equal(table.props.cells[0][0].primary.note,'Provider');
  assert.equal(table.props.cells[0][1].primary.meter.width,120);
  assert.equal(table.props.rows[0][0],'m0 · Provider');
  const more=nodes.get('usage-breakdown-more');
  assert.equal(more.calls.label[0],'Show all 7');
  more.calls.on_click[0](null,{notify(){}});
  nodes.clear();distribution(view,data);
  assert.equal(nodes.get('usage-breakdown').props.rows.length,VISIBLE+1);
  assert.equal(nodes.get('usage-breakdown-more').calls.label[0],'Show less');
  view.state.query.dimension='project';nodes.clear();distribution(view,data);
  assert.equal(nodes.get('usage-breakdown-loading').kind,'Loading');assert.equal(nodes.has('usage-breakdown'),false);
});

test('request tables use eight one-line columns with a total footer',async()=>{
  const {nodes,context}=elements();
  const {requests}=vm.runInNewContext(`${await viewSource()}\n({requests})`,context);
  const state=new State(node),request={position:{node,timestamp_ms:'1',sequence:'1'},model:'Model',provider_name:'Provider',scope_name:'Project',
    session_title:'Title',tokens:{input:'1200',output:'340',cached_input:'100',reasoning:'20'},first_token_us:'1250',elapsed_us:'1000000',usd_micros:'123'};
  const data=items=>({totals:{responses:'1234'},requests:{items,has_more:false}});
  const content=requests({state,text:messages('en')},data([request])),table=nodes.get('usage-requests');
  assert.equal(content.items[1].selector,'usage-table');assert.equal(nodes.get('usage-table').calls.h[0],72);
  assert.equal(table.kind,'DataTable');assert.equal(table.props.row_height,40);assert.equal(table.props.header_height,32);
  assert.deepEqual(plain(table.props.columns),['Time','Session','Model','Input · Cache','Output','First token','Duration','Cost']);
  assert.deepEqual(plain(table.props.alignments),['start','start','start','end','end','end','end','end']);
  assert.equal(table.props.widths.length,8);
  assert.equal(table.props.cells[0][1].primary.chip,'Project');assert.equal(table.props.rows[0][7],'0.000123');
  assert.equal(nodes.get('usage-pagination').items[0].items[0],'1,234 total');
  assert.equal(nodes.has('usage-pages'),false);
  requests({state,text:messages('en')},{...data([]),requests:{items:[],has_more:true}});
  assert.equal(nodes.get('usage-table').calls.h[0],224);
  assert.equal(nodes.get('usage-requests').props.empty_icon,'chart-pie');
  assert.equal(nodes.get('usage-pages').kind,'Pagination');
});
