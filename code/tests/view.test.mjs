import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {installed,installing,available} from '../dev.sailry.platform/desktop/model.js';
import {messages} from '../dev.sailry.platform/desktop/locales.js';

class Element {
  constructor(kind,props={}) { this.kind=kind;this.props=props;this.items=[];this.style={}; }
  child(value) { this.items.push(value);return this; }
  children(values) { this.items.push(...values);return this; }
}
function element(kind,props) {
  const value=new Element(kind,props);
  const proxy=new Proxy(value,{get:(target,key)=>key in target ? target[key] : (...args)=>{
    target.style[key]=args;return proxy;
  }});
  return proxy;
}
const source=readFileSync(new URL('../dev.sailry.platform/desktop/view.js',import.meta.url),'utf8')
  .replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const {render}=vm.runInNewContext(source+'\n({render})',{
  installed,installing,available,div:()=>element('div'),theme:()=>({colors:{muted_foreground:'#999'}}),
  Button:class {constructor(id){return element('button',{id});}},
  Switch:class {constructor(id){return element('switch',{id});}},
  Toggle:{new:(id,props)=>element('switch',{id,...props})},
  SettingsGroup:{new:(id,props)=>element('group',{id,...props})},
  SegmentedTabs:{new:(id,props)=>element('tabs',{id,...props})},
  IconButton:{new:(id,props)=>element('icon-button',{id,...props})},
  CardList:{new:(id,props)=>element('card-list',{id,...props})},
  Modal:{new:(id,props)=>element('modal',{id,...props})},
});
function descendants(value) {
  return value && typeof value==='object' ? [value,...value.items.flatMap(descendants)] : [];
}
function find(tree,id) { return descendants(tree).find(value=>value.props.id===id || value.style.id?.[0]===id); }
function fixture(items,tab='available') {
  return {text:messages('zh-CN'),tab,saved:{servers:{}},rows:()=>items,busy:()=>false,clean:()=>true,
    ready:true,loading:false,pending:false,request:null,dialog:null};
}
function candidate(name,install,status='not_installed') {
  return {server:name,languages:['Ada'],candidate:{server:name,status,package:{name,version:'1',install,
    unavailable:install ? null : 'language source requires unsupported build or version rules'}}};
}

test('editor switch defaults off with accessible name',()=>{
  const view=fixture([]);
  let tree=render(view),control=find(tree,'code-editor-enabled');
  assert.equal(control.kind,'switch');
  assert.equal(control.props.checked,false);
  assert.equal(control.props.disabled,false);
  assert.equal(control.props.label,view.text.code_editor_enabled);
  assert.equal(find(tree,'settings-row-code-editor').items[0].items[0],view.text.code_editor_enabled);
  view.saved.editor_enabled=true;view.busy=()=>true;
  tree=render(view);control=find(tree,'code-editor-enabled');
  assert.equal(control.props.checked,true);
  assert.equal(control.props.disabled,true);
});

test('available list hides unsupported but retains busy entries',()=>{
  const supported=candidate('supported',{package:'supported'}),unsupported=candidate('unsupported',null);
  const active={server:'removed',languages:[],installation:{package:'removed',status:'downloading'}};
  const view=fixture([supported,unsupported,active]);view.busy=()=>true;view.loading=true;
  const tree=render(view);
  assert(find(tree,'code-server-supported'));
  assert.equal(find(tree,'code-install-supported').props.disabled,true);
  assert.equal(find(tree,'code-server-unsupported'),undefined);
  assert(find(tree,'code-server-removed'));
  assert.equal(find(tree,'code-cancel-removed').props.disabled,false);
});
test('installed list retains unavailable and removed packages',()=>{
  const managed=candidate('managed',null),global=candidate('global',null,'stopped');
  managed.installation={package:'managed',receipt:{version:'1'},status:'ready'};
  const orphan={server:'orphan',languages:[],installation:{package:'orphan',receipt:{version:'1'},status:'ready'}};
  const tree=render(fixture([managed,global,orphan,candidate('available',{})],'installed'));
  for (const name of ['managed','global','orphan']) assert(find(tree,`code-server-${name}`));
  assert.equal(find(tree,'code-server-available'),undefined);
});
test('details localizes Cancel and removes availability button',()=>{
  const item=candidate('ada',null,'stopped'),view=fixture([item],'installed');
  view.dialog={id:'details',kind:'details',row:item};
  const tree=render(view),modal=find(tree,'details');
  assert.equal(modal.props.width,600);
  assert.equal(find(tree,'code_information').props.variant,'outline');
  assert.equal(find(tree,'code_settings').props.variant,undefined);
  assert.equal(find(tree,'code_languages').props.variant,undefined);
  assert.equal(find(tree,'code-details-close').items[0].style.label[0],'取消');
  assert.equal(find(tree,'code-detail-availability-info'),undefined);
  assert(find(tree,'code-detail-package'));
  assert.equal(find(tree,'code-details-update').items[0].style.disabled[0],true);
});
test('details installs directly with exact source metadata',()=>{
  const install={package:'analyzer',version:'2',purl:'pkg:npm/analyzer@2',urls:[],licenses:[],command:{program:'npm',arguments:['install']}};
  const item=candidate('ada',install),view=fixture([item]);
  view.dialog={id:'details',kind:'details',row:item};
  const calls=[];view.install=(row,cx)=>calls.push({row,cx});
  const tree=render(view),button=find(tree,'code-details-install').items[0],cx={};
  button.style.on_click[0]({},cx);
  assert.equal(calls.length,1);assert.equal(calls[0].row,item);assert.equal(calls[0].cx,cx);
  assert(find(tree,'code-detail-source'));assert(find(tree,'code-detail-version'));
  assert.equal(find(tree,'code-detail-downloads'),undefined);
  assert.equal(find(tree,'code-detail-licenses'),undefined);
  assert.equal(find(tree,'code-consent-details'),undefined);
  assert.equal(find(tree,'code-consent-code_install_command'),undefined);
});
test('update shows current and target versions',()=>{
  const item=candidate('ada',{package:'analyzer',version:'2',purl:'pkg:npm/analyzer@2'});
  item.installation={package:'analyzer',status:'ready',receipt:{package:'analyzer',version:'1'}};
  const view=fixture([item],'installed');view.dialog={id:'details',kind:'details',row:item};
  const tree=render(view),version=find(tree,'code-detail-version');
  assert.equal(version.items[1].items[0],'1 → 2');
  assert.equal(find(tree,'code-details-update').items[0].style.disabled[0],false);
  assert(find(tree,'code-details-uninstall'));
});
