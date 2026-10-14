import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {State,RANGES,DIMENSIONS,query,choices} from '../dev.sailry.platform/desktop/state.js';
import {messages} from '../dev.sailry.platform/desktop/locales.js';
import {compact,grouped,duration} from '../dev.sailry.platform/desktop/format.js';
import {formatRows,mark} from '../dev.sailry.platform/desktop/requests.js';
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
  const tasks = [], events = [], controls = [], calls = [], notices=[],cx = {spawn:task => tasks.push(task), notify() {}};
  const {Usage} = vm.runInNewContext(`${source}\n({Usage})`, {
    View:class {}, context:() => JSON.stringify({node,locale:'en'}), State, RANGES, query, choices, messages,
    nextTableEvent:async () => { throw new Error('closed'); },
    header_action:async () => { if (!events.length) throw new Error('closed'); return events.shift(); },
    nextControlEvent:async () => { if (!controls.length) throw new Error('closed'); return controls.shift(); },
    selectHost:() => assert.fail('Usage filters must not navigate'),
    watchUsage:(query,all,target=node) => calls.push(['watch',plain(query),all,target]),
    nextUsageChange:async () => { throw new Error('closed'); },
    refreshUsage:() => calls.push(['refresh']),
    toast:value=>notices.push(value),
  });
  const view = new Usage();
  view.init({},cx);
  const [header,control] = tasks.slice(-2);
  return {view,cx,calls,tasks,events,notices,header:() => header(cx),control:() => control(cx),
    select:(field,value,generation=view.state.generation) => controls.push({id:`usage-filter-${field}`,value:`${generation}:${value}`})};
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
  const setup = fixture();
  assert.deepEqual(plain(setup.view.filters().selects.map(select => select.id)), ['usage-filter-project','usage-filter-provider','usage-filter-model']);
  setup.select('host',remote);
  setup.select('host','all');
  setup.select('provider','selected');
  setup.select('provider','stale',1);
  setup.select('project','project-a',2);
  await setup.control();
  const {range,selects} = setup.view.filters();
  assert.deepEqual(plain(range.items.map(item => item.label)), ['24 hours','7 days','30 days','90 days','1 year']);
  assert.equal(range.selected, '30d');
  assert.equal(selects[0].selected, `${setup.view.state.generation}:project-a`);
  assert.equal(selects[0].label, 'All projects');
  assert(selects.every(select => select.items.every(item => item.id.startsWith(`${setup.view.state.generation}:`))));
  assert.deepEqual(setup.calls.filter(call => call[0] === 'watch').map(call => call.slice(2)), [[false,node],[false,node],[false,node]]);
  assert.equal(setup.view.state.node, node);
  assert.deepEqual(setup.view.state.query.providers, []);
  assert.deepEqual(setup.view.state.query.projects, ['project-a']);
});

test('header keeps only the title and refresh action', () => {
  const header = fixture().view.header();
  assert.deepEqual(Object.keys(header), ['title','actions']);
  assert.equal(header.title, 'Usage');
  assert.deepEqual(plain(header.actions.map(action => action.id)), ['usage-refresh']);
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
    SelectField:{new:(id,props) => element('SelectField',id,props)},
    TabBar:function(id) {return element('TabBar',id);}, Tab:function() {return element('Tab');},
    theme:() => ({colors:{muted_foreground:'muted'}}),
  });
  const {view} = fixture();
  render(view);
  assert.equal(nodes.get('usage-page').items[0].selector, 'usage-header');
  const header = JSON.parse(nodes.get('usage-header').props.content);
  assert.equal(header.title, 'Usage');assert.equal(header.filters, undefined);
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
  const adapters=Object.fromEntries(['Header','SettingsGroup','DataTable','Loading','ProgressBar','SelectField']
    .map(kind=>[kind,{new:(id,props)=>element(kind,id,props)}]));
  const constructors=Object.fromEntries(['Button','Tab','TabBar','Tag','Pagination','Progress']
    .map(kind=>[kind,function(id){return element(kind,id);}]));
  const context={div:()=>element(),theme:()=>({colors:{muted_foreground:'muted'}}),...adapters,...constructors,
    compact,grouped,percent,breakdown,VISIBLE,DIMENSIONS,formatRows,mark,...extra};
  return {nodes,context};
}
const viewSource=async()=>(await readFile(new URL('../dev.sailry.platform/desktop/view.js',import.meta.url),'utf8'))
  .replace(/^import .*;\n/gm,'').replace(/^export /gm,'');

test('breakdown tables reuse one card and fold beyond six rows',async()=>{
  const {nodes,context}=elements(),groups=[];
  const {card,distribution}=vm.runInNewContext(`${await viewSource()}\n({card,distribution})`,context);
  const notices=[],view={text:messages('en'),state:new State(node),group:value=>notices.push(value),
    inventory:{node,projects:[],providers:[{id:'p',name:'Provider',icon:'icons/providers/openai.svg',models:[]}]}},data={node,groups,query:{dimension:'model'}};
  card('usage-breakdown-card',distribution(view,data));
  const group=nodes.get('usage-breakdown-card-box');
  assert.equal(group.kind,'SettingsGroup');assert.deepEqual(plain(group.props),{heading:false});
  let table=nodes.get('usage-breakdown');
  assert.equal(table.kind,'DataTable');assert.deepEqual(plain(table.props.rows),[]);
  assert.equal(table.props.empty,view.text.usage_empty);assert.equal(table.props.header_height,32);
  assert.deepEqual(plain(table.props.columns),['Name','Share','Tokens','Cache hits','Responses','Cost']);
  assert.equal(table.props.fill,1);
  assert.equal(nodes.has('usage-breakdown-more'),false);
  const tabs=nodes.get('usage-breakdown-tabs');
  assert.equal(tabs.calls.selected_index[0],0);assert.equal(tabs.items.length,3);
  tabs.calls.on_change[0](2,{});assert.deepEqual(notices,['project']);
  for(let index=0;index<VISIBLE+1;index++)groups.push({key:{kind:'model',data:{model:`m${index}`,provider:'p'}},name:'Provider',
    metrics:{responses:'1',tokens:{input:String(10-index),output:'0',cached_input:'0',reasoning:'0'}}});
  nodes.clear();distribution(view,data);table=nodes.get('usage-breakdown');
  assert.equal(table.props.rows.length,VISIBLE);
  assert.equal(table.props.cells[0][0].primary.note,'Provider');
  assert.equal(table.props.cells[0][0].primary.badge_icon,'icons/providers/openai.svg');
  const meter=table.props.cells[0][1].primary.meter;
  assert.equal(meter.fill,true);assert.equal(meter.width,undefined);
  assert.equal(table.props.rows[0][0],'m0 · Provider');
  const more=nodes.get('usage-breakdown-more');
  assert.equal(more.calls.label[0],'Show all');
  more.calls.on_click[0](null,{notify(){}});
  nodes.clear();distribution(view,data);
  assert.equal(nodes.get('usage-breakdown').props.rows.length,VISIBLE+1);
  assert.equal(nodes.get('usage-breakdown-more').calls.label[0],'Show less');
  view.state.query.dimension='project';nodes.clear();distribution(view,data);
  assert.equal(nodes.get('usage-breakdown-loading').kind,'Loading');assert.equal(nodes.has('usage-breakdown'),false);
});

test('filters render above the cards and drive queries',async()=>{
  const {nodes,context}=elements();
  const {render}=vm.runInNewContext(`${await viewSource()}\n({render})`,context);
  const setup=fixture();
  render(setup.view);
  assert.equal(nodes.get('usage-content').items[0].selector,'usage-filters');
  assert.deepEqual(plain(nodes.get('usage-filters').calls.flex_wrap),[]);
  const range=nodes.get('usage-filter-range');
  assert.equal(range.kind,'TabBar');assert.equal(range.calls.selected_index[0],2);assert.equal(range.items.length,5);
  const selects=nodes.get('usage-filter-selects').items.map(item=>item.items[0]);
  assert(selects.every(select=>select.kind==='SelectField'));
  assert.deepEqual(plain(selects.map(select=>[select.selector,select.props.label])),
    [['usage-filter-project','All projects'],['usage-filter-provider','All providers'],['usage-filter-model','All models']]);
  range.calls.on_change[0](0,setup.cx);
  assert.equal(setup.view.state.range,'24h');
  assert.equal(setup.calls.filter(call=>call[0]==='watch').length,2);
  setup.select('model','gpt');await setup.control();
  assert.deepEqual(setup.view.state.query.models,['gpt']);
  assert.equal(setup.calls.filter(call=>call[0]==='watch').length,3);
});

test('request tables fill the session column and split cache hits',async()=>{
  const {nodes,context}=elements();
  const {requests}=vm.runInNewContext(`${await viewSource()}\n({requests})`,context);
  const state=new State(node),request={position:{node,timestamp_ms:'1',sequence:'1'},model:'Model',provider:'p',provider_name:'Provider',scope_name:'Project',
    session_title:'Title',tokens:{input:'1200',output:'340',cached_input:'100',reasoning:'20'},first_token_us:'1250',elapsed_us:'1000000',usd_micros:'123'};
  const data=items=>({totals:{responses:'1234'},requests:{items,has_more:false}});
  const inventory={node,projects:[],providers:[{id:'p',name:'Provider',icon:'icons/providers/xai.svg',models:[]}]};
  const content=requests({state,text:messages('en'),inventory},{...data([request]),node}),table=nodes.get('usage-requests');
  assert.equal(content.items[1].selector,'usage-table');assert.equal(nodes.get('usage-table').calls.h[0],72);
  assert.equal(table.kind,'DataTable');assert.equal(table.props.row_height,40);assert.equal(table.props.header_height,32);
  assert.deepEqual(plain(table.props.columns),['Time','Session','Model','Input','Cached','Output','First token','Duration','Cost']);
  assert.deepEqual(plain(table.props.alignments),['start','start','start','end','end','end','end','end','end']);
  assert.equal(table.props.widths.length,9);assert.equal(table.props.fill,1);
  assert(table.props.widths.slice(5).every(width=>width>=72));
  assert.equal(table.props.cells[0][1].primary.chip,'Project');assert.equal(table.props.rows[0][8],'0.000123');
  assert.equal(table.props.cells[0][2].primary.badge_icon,'icons/providers/xai.svg');
  assert.equal(table.props.cells[0][4].primary.meter.label,'8%');
  assert.equal(nodes.get('usage-pagination').items[0].items[0],'1,234 total');
  assert.equal(nodes.has('usage-pages'),false);
  requests({state,text:messages('en')},{...data([]),requests:{items:[],has_more:true}});
  assert.equal(nodes.get('usage-table').calls.h[0],224);
  assert.equal(nodes.get('usage-requests').props.empty_icon,'chart-pie');
  assert.equal(nodes.get('usage-pages').kind,'Pagination');
});
