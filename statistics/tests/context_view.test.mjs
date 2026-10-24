import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {history,latency} from '../dev.sailry.platform/desktop/context.js';
import {compact,duration} from '../dev.sailry.platform/desktop/format.js';
import {messages} from '../dev.sailry.platform/desktop/locales.js';

const source=(await readFile(new URL('../dev.sailry.platform/desktop/context_view.js',import.meta.url),'utf8'))
  .replace(/^import .*;\n/gm,'').replace(/^export /gm,'');

test('composer toggles steps and clears stale selections',async()=>{
  const state={statistics:{observations:{recent:['first','second'].map((id,index)=>({
    id,turn:id,turn_index:String(index+1),model:'fixture',attempts:[{categories:[],complete_context:false}],
  }))}}};
  const composer=(await readFile(new URL('../dev.sailry.platform/desktop/composer.js',import.meta.url),'utf8'))
    .replace(/^import .*;\n/gm,'').replace('export default class','class');
  const {Composer}=vm.runInNewContext(`${composer}\n({Composer})`,{
    View:class {},context:()=>JSON.stringify({locale:'en'}),readComposer:()=>state,messages,history,
    metrics:()=>[],publishContributions:()=>{},
  });
  const view=new Composer();
  view.init(null,{spawn:()=>{}});
  assert.equal(view.selected,null);
  view.select('first');assert.equal(view.selected,'first');
  assert.equal(view.expanded.has('occupancy'),true);
  view.select('first');assert.equal(view.selected,null);
  view.select('first');view.select('second');assert.equal(view.selected,'second');
  view.state={statistics:{observations:{recent:state.statistics.observations.recent.slice(0,1)}}};
  view.publish();assert.equal(view.selected,null);
  view.select('first');assert.equal(view.selected,'first');
  view.select('removed');assert.equal(view.selected,null);
});

test('connection observations resolve every background through semantic colors',()=>{
  const backgrounds=[];
  const colors={muted:'#161616',muted_foreground:'#aaaaaa',border:'#333333',
    success:'#00aa00',warning:'#aa8800',destructive:'#cc0000'};
  const element=()=>new Proxy({}, {get:(_target,key)=>{
    if(key==='bg')return color=>{
      assert.equal(typeof color,'string','background must resolve to a semantic color');
      backgrounds.push(color);return element();
    };
    return ()=>element();
  }});
  const {connection}=vm.runInNewContext(`${source}\n({connection})`,{
    div:element,Button:{new:element},Collapsible:class {constructor(){return element();}},
    Icon:class {constructor(){return element();}},theme:()=>({colors}),latency,compact,duration,
  });
  for(const value of [null,0n,2000000n,15000000n]) {
    backgrounds.length=0;
    connection({text:messages('en'),expanded:new Set()},{connection:{response:value,waiting:value}});
    const expected=colors[value==null?'muted_foreground':value===0n?'success':value===2000000n?'warning':'destructive'];
    assert.ok(backgrounds.includes(expected));
  }
});
