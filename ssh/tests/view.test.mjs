import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {messages} from '../dev.sailry.platform/desktop/locales.js';

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
  const adapters=Object.fromEntries(['Workspace','EmptyState','Loading','Picker','SelectableRow','IconButton',
    'NativeContextMenu','Modal','ActionScope','Loading','Header','Terminal']
    .map(kind=>[kind,{new:(id,props)=>element(kind,id,props)}]));
  const {render}=vm.runInNewContext(`${source}\n({render})`,{
    div:()=>element(),...adapters,Icon:function(path){return element('Icon',null,{path});},
    theme:()=>({colors:{muted_foreground:'muted'}}),
  });
  const view={text:messages('en'),profiles:[],terminals:[],terminal:null,home:false,loaded:false,
    pending:null,error:null,editor:null,confirmation:null,fileEdit:null,transfer:null,commandOpen:false,
    dialog:0,picker:false,pickerRevision:0,pickerProfile:null,locked:()=>false,activeProfile:()=>null};
  return {view,nodes,render(){nodes.clear();return render(view);}};
}

test('initial reads reserve the workspace instead of showing landing',()=>{
  const setup=fixture();
  for(const error of [null,'unavailable']) {
    setup.view.error=error;setup.render();
    assert.equal(setup.nodes.has('ssh-loading-rows'),false);
    assert.deepEqual(plain(setup.nodes.get('ssh-loading').style.size_full),[]);
    assert.equal(setup.nodes.has('ssh_workspace_empty'),false);
    assert.ok(setup.nodes.has('ssh-header'));assert.ok(setup.nodes.has('ssh-workspace'));
  }
  setup.view.loaded=true;setup.render();
  assert.equal(setup.nodes.has('ssh-loading-rows'),false);
  assert.ok(setup.nodes.has('ssh_workspace_empty'));
});

test('restored terminals and their tabs remain during refresh failures',()=>{
  const setup=fixture();
  setup.view.loaded=true;
  setup.view.profiles=[{id:'profile',name:'Saved host',username:'user',host:'host',port:22}];
  setup.view.terminals=[{id:'terminal',ssh:'profile'}];setup.view.terminal='terminal';
  for(const error of [null,'unavailable']) {
    setup.view.error=error;setup.render();
    assert.equal(setup.nodes.get('ssh-terminal-terminal').kind,'Terminal');
    assert.equal(setup.nodes.has('ssh-loading-rows'),false);
    assert.equal(setup.nodes.has('ssh_workspace_empty'),false);
    const header=JSON.parse(setup.nodes.get('ssh-header').props.content);
    assert.equal(header.tabs.selected,'terminal');
    assert.equal(header.tabs.items[0].label,'Saved host');
  }
});
