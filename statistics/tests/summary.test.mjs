import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {SERIES} from '../dev.sailry.platform/desktop/charts.js';
import {compact,grouped} from '../dev.sailry.platform/desktop/format.js';
import {messages} from '../dev.sailry.platform/desktop/locales.js';
import {overview,percent} from '../dev.sailry.platform/desktop/summary.js';

const totals=(cost)=>({responses:'4',tokens:{input:'100',output:'25',cached_input:'60',reasoning:'7'},
  generation:{output_tokens:'25',elapsed_us:'500000',responses:'2'},
  throughput:{output_tokens:'25',elapsed_us:'1000000',responses:'2'},...cost ? {cost} : {}});

test('composition splits cached, uncached and output tokens',()=>{
  const values=overview(totals());
  assert.equal(values.total,125n);
  assert.deepEqual(values.parts,[60n,40n,25n]);
  assert.deepEqual(values.shares.map(percent),['48.0%','32.0%','20.0%']);
  assert.equal(values.reasoning,7n);
  assert.equal(values.hit,60);
  assert.equal(values.responses,4n);
  assert.equal(values.reported,4n);
  assert.equal(values.speed,'25.0');
});

test('subtotal composition uses only reporting responses',()=>{
  const report=totals();
  const values=overview({...report,responses:'9007199254740993',tokens:null,token_subtotal:report.tokens,
    incomplete_token_responses:'9007199254740992'});
  assert.deepEqual([values.total,values.reported,values.responses],[125n,1n,9007199254740993n]);
  assert.deepEqual(values.parts,[60n,40n,25n]);
  assert.deepEqual(values.shares.map(percent),['48.0%','32.0%','20.0%']);
  assert.equal(values.reasoning,7n);
  assert.equal(values.hit,null);
  assert.equal(values.speed,'25.0');
});

test('reported zero differs from missing token usage',()=>{
  const report={responses:'2',tokens:null,incomplete_token_responses:'2'};
  const unknown=overview(report);
  const zero=overview({...report,incomplete_token_responses:'1',token_subtotal:{input:'0',output:'0',cached_input:'0',reasoning:'0'}});
  assert.deepEqual([unknown.total,unknown.reported,unknown.parts,unknown.reasoning],[null,0n,null,null]);
  assert.deepEqual([zero.total,zero.reported,zero.parts,zero.reasoning],[0n,1n,[0n,0n,0n],0n]);
});

async function reportSummary() {
  const source=(await readFile(new URL('../dev.sailry.platform/desktop/view.js',import.meta.url),'utf8'))
    .replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
  const nodes=new Map(),children=new WeakMap();
  function element() {
    const items=[];
    const node=new Proxy({},{get:(_,key)=>value=>{
      if(key==='id')nodes.set(value,items);
      if(key==='child')items.push(value);
      if(key==='children')items.push(...value);
      return node;
    }});
    children.set(node,items);
    return node;
  }
  const {summary}=vm.runInNewContext(`${source}\n({summary})`,{
    div:element,theme:()=>({colors:{}}),window:{viewport_size:()=>({width:1040})},ProgressBar:{new:element},
    overview,percent,SERIES,compact,grouped,
  });
  const contents=items=>items.flatMap(item=>typeof item==='string' ? [item] : contents(children.get(item) ?? []));
  return totals=>{
    nodes.clear();
    summary({text:messages('en')},totals);
    return id=>nodes.has(id) ? contents(nodes.get(id)) : null;
  };
}

test('overview marks a subtotal zero but not a complete zero',async()=>{
  const render=await reportSummary(),tokens={input:'0',output:'0',cached_input:'0',reasoning:'0'};
  const complete=render({responses:'1',tokens});
  assert.deepEqual(complete('usage-total'),['0']);
  assert.equal(complete('usage-token-coverage'),null);
  const partial=render({responses:'2',tokens:null,token_subtotal:tokens,incomplete_token_responses:'1'});
  assert.deepEqual(partial('usage-total'),['Subtotal: 0']);
  assert.deepEqual(partial('usage-token-coverage'),['1 of 2 responses reported both token counts']);
});

test('Usage overview renders end-to-end TPS with units only for a measured rate',async()=>{
  const render=await reportSummary(),report=totals();
  assert.deepEqual(render(report)('usage-stat-speed'),['End-to-end TPS','25.0','tok/s']);
  assert.deepEqual(render({...report,throughput:undefined})('usage-stat-speed'),['End-to-end TPS','—']);
  assert.deepEqual(render({...report,throughput:{...report.throughput,output_tokens:'0'}})('usage-stat-speed'),
    ['End-to-end TPS','0.0','tok/s']);
});

test('cost is partial when some responses lack prices',()=>{
  assert.deepEqual([overview(totals()).cost,overview(totals()).partial],[null,false]);
  const partial=overview(totals({usd_micros:'1500000',responses:'3'}));
  assert.deepEqual([partial.cost,partial.priced,partial.partial],['1.50',3n,true]);
  const full=overview(totals({usd_micros:'10000',responses:'4'}));
  assert.deepEqual([full.cost,full.partial],['0.01',false]);
});

test('unknown totals stay unknown',()=>{
  const values=overview({responses:'0',tokens:null});
  assert.deepEqual([values.total,values.parts,values.shares,values.hit,values.reasoning,values.speed],[null,null,null,null,null,null]);
  assert.equal(overview(null).responses,0n);
  assert.equal(overview({responses:'1',tokens:{input:'0',output:'0',cached_input:'0',reasoning:'0'}}).hit,null);
  assert.equal(percent(null),null);
});
