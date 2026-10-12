import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {State} from '../dev.sailry.platform/desktop/state.js';
import {messages} from '../dev.sailry.platform/desktop/locales.js';
import {compact,total,integer,amount,speed,ranking} from '../dev.sailry.platform/desktop/format.js';
import {heatmap,trend} from '../dev.sailry.platform/desktop/charts.js';
import {formatRows} from '../dev.sailry.platform/desktop/requests.js';

const source=(await readFile(new URL('../dev.sailry.platform/desktop/view.js',import.meta.url),'utf8'))
  .replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const plain=value=>JSON.parse(JSON.stringify(value));

function fixture() {
  const nodes=new Map();
  function element(kind='div',id=null,props={}) {
    const value={kind,selector:id,props,items:[],style:{}};
    const proxy=new Proxy(value,{get(target,key) {
      if(key==='id')return id=>{target.selector=id;nodes.set(id,proxy);return proxy;};
      if(key==='child')return child=>{target.items.push(child);return proxy;};
      if(key==='children')return children=>{target.items.push(...children);return proxy;};
      if(key in target)return target[key];
      return (...args)=>{target.style[key]=args;return proxy;};
    }});
    if(id)nodes.set(id,proxy);
    return proxy;
  }
  const adapters=Object.fromEntries(['Header','EmptyState','SettingsGroup','DataTable','Heatmap','StackedChart','ProgressBar','Loading']
    .map(kind=>[kind,{new:(id,props)=>element(kind,id,props)}]));
  const constructors=Object.fromEntries(['Icon','Progress','Tab','TabBar','Pagination']
    .map(kind=>[kind,function(id){return element(kind,id);} ]));
  const {render}=vm.runInNewContext(`${source}\n({render})`,{
    div:()=>element(),...adapters,...constructors,compact,total,integer,amount,speed,ranking,heatmap,trend,formatRows,
    theme:()=>({colors:{muted_foreground:'muted'}}),window:{viewport_size:()=>({width:1440})},
  });
  const view={state:new State('captured'),text:messages('en'),error:null,header:()=>({title:'Usage'})};
  return {view,nodes,render(){nodes.clear();return render(view);}};
}

test('initial reads use shared rows without fabricated usage',()=>{
  const setup=fixture();
  for(const error of [null,'usage_read_failed']) {
    setup.view.error=error;setup.render();
    assert.equal(setup.nodes.get('usage-initial-loading').kind,'Loading');
    assert.equal(setup.nodes.has('usage-summary'),false);
    assert.equal(setup.nodes.has('usage-ranking-empty'),false);
    assert.equal(setup.nodes.has('usage-requests'),false);
    assert.ok(setup.nodes.has('usage-header'));assert.ok(setup.nodes.has('usage-content'));
  }
});

test('filter refreshes retain report sections and avoid flow changes',()=>{
  const setup=fixture(),{state}=setup.view;
  const report={node:'captured',totals:{responses:'0',tokens:null,cost:null,generation:null},days:[],groups:[],requests:{items:[],has_more:false}};
  state.accept({cursor:'1',all:false,view:{report,connected:true,refreshing:false}},state.start());
  setup.render();
  const selectors=setup.nodes.get('usage-content').items.map(item=>item.selector);
  assert.deepEqual(selectors,['usage-summary','usage-activity-card','usage-trend-card','usage-ranking-card','usage-requests-card']);
  state.select('project','selected');const generation=state.start();
  for(const observation of [null,{report:null,connected:true,refreshing:true},
    {report:null,connected:true,refreshing:false,error:{code:'unavailable'}}]) {
    if(observation)state.accept({cursor:observation.refreshing?'1':'2',all:false,view:observation},generation);
    setup.view.error=observation?.error?'usage_read_failed':null;setup.render();
    assert.equal(state.data(),report);
    const body=setup.nodes.get('usage-content');
    assert.deepEqual(body.items.filter(item=>item.selector).map(item=>item.selector),selectors);
    assert.equal(setup.nodes.has('usage-initial-loading'),false);
    if(!setup.view.error) {
      const progress=setup.nodes.get('usage-loading'),wrapper=body.items.find(item=>item.items.includes(progress));
      assert.ok(wrapper);assert.deepEqual(plain(wrapper.style.absolute),[]);
      assert.deepEqual(plain(wrapper.style.top_0),[]);
    } else assert.equal(setup.nodes.has('usage-loading'),false);
  }
});
