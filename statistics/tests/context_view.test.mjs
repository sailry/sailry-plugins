import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {latency} from '../dev.sailry.platform/desktop/context.js';
import {compact,duration} from '../dev.sailry.platform/desktop/format.js';
import {messages} from '../dev.sailry.platform/desktop/locales.js';

const source=(await readFile(new URL('../dev.sailry.platform/desktop/context_view.js',import.meta.url),'utf8'))
  .replace(/^import .*;\n/gm,'').replace(/^export /gm,'');

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
