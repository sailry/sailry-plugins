import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {messages} from '../dev.sailry.platform/desktop/locales.js';

const source = (await readFile(new URL('../dev.sailry.platform/desktop/view.js',import.meta.url),'utf8'))
  .replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const plain = value => JSON.parse(JSON.stringify(value));

function fixture() {
  const nodes=new Map(),calls=[];
  function element(kind='div',id=null,props={}) {
    const value={kind,selector:id,props,items:[],style:{}};
    const proxy=new Proxy(value,{get(target,key) {
      if(key==='id')return id=>{target.selector=id;nodes.set(id,proxy);return proxy;};
      if(key==='child')return child=>{target.items.push(child);return proxy;};
      if(key==='children')return children=>{target.items.push(...children);return proxy;};
      if(key in target)return target[key];
      if(key==='on_click'||key==='on_change')return callback=>{target[key]=callback;return proxy;};
      return (...args)=>{target.style[key]=args;return proxy;};
    }});
    if(id)nodes.set(id,proxy);
    return proxy;
  }
  const adapters=Object.fromEntries(['EmptyState','SettingsGroup','IconButton','Appearance','AppearancePicker','Menu','Modal','TextField']
    .map(kind=>[kind,{new:(id,props)=>element(kind,id,props)}]));
  const {render}=vm.runInNewContext(`${source}\n({render})`,{
    div:()=>element(),Button:function(id){return element('Button',id);},
    Checkbox:function(id){return element('Checkbox',id);},
    Field:function(){return element('Field');},Form:function(){return element('Form');},...adapters,
    efforts:()=>[null],window:{viewport_size:()=>({width:1280,height:820})},
    theme:()=>({colors:{muted_foreground:'muted'}}),
  });
  const view={text:{settings_empty:'No roles',settings_add:'Add',settings_edit:'Edit',settings_delete:'Delete',roles_profiles:'Roles'},
    roles:[],ready:true,connected:true,error:null,dialog:null,edit:role=>calls.push(['edit',role]),research:()=>calls.push(['research'])};
  return {view,nodes,calls,render(){nodes.clear();return render(view);}};
}

test('empty roles reuse their settings card and retain the add action',()=>{
  const setup=fixture();setup.render();
  const group=setup.nodes.get('roles_profiles'),empty=setup.nodes.get('role-empty');
  assert.deepEqual(plain(group.props),{title:'Roles',header_action:true});
  assert.deepEqual(plain(empty.props),{variant:'list',icon:'inbox',label:'No roles'});
  assert.equal(group.items[1],empty);
  setup.nodes.get('role-add').items[0].on_click({},{});
  assert.deepEqual(setup.calls,[['edit',null]]);
});

test('research has an explicit action and preserves existing role edits',()=>{
  const setup=fixture();setup.view.text=messages('en');setup.render();
  const action=setup.nodes.get('role-add-research').items[0];
  assert.deepEqual(plain(action.style.label),['Add research']);
  assert.deepEqual(plain(action.style.disabled),[false]);
  action.on_click({},{});
  assert.deepEqual(setup.calls,[['research']]);
  setup.view.roles=[{id:'existing',key:'research',name:'Custom researcher'}];setup.render();
  assert.deepEqual(plain(setup.nodes.get('role-add-research').items[0].style.disabled),[true]);
  assert.ok(setup.nodes.has('role-edit-existing'));
});

test('research labels are translated while instructions stay English',()=>{
  for(const locale of ['en','de','es','fr','ja','ko','pt-BR','ru','zh-CN','zh-TW']) {
    const text=messages(locale);
    assert.ok(text.role_add_research.length>0);
    assert.ok(text.role_research_description.length>0);
    assert.equal(text.role_prompt_research,messages('en').role_prompt_research);
    if(locale!=='en')assert.notEqual(text.role_add_research,messages('en').role_add_research);
  }
});

test('readonly editing reuses Checkbox and locks uncertain drafts',()=>{
  const setup=fixture(),owner={kind:'edit',token:'dialog',readOnly:true,request:null,
    fields:{key:'key',name:'name',turns:'turns',instructions:'instructions'},models:[],fixed:false,model:null};
  setup.view.text=messages('en'); setup.view.dialog=owner; setup.render();
  let control=setup.nodes.get('role-read-only-toggle');
  assert.equal(control.kind,'Checkbox');
  assert.deepEqual(plain(control.style.checked),[true]);
  assert.deepEqual(plain(control.style.label),['Read only']);
  control.on_change(false,{notify(){}}); assert.equal(owner.readOnly,false);
  owner.request='uncertain'; setup.render(); control=setup.nodes.get('role-read-only-toggle');
  assert.deepEqual(plain(control.style.disabled),[true]);
  control.on_change(true,{notify(){throw new Error('locked draft changed');}});
  assert.equal(owner.readOnly,false);
});

test('readonly copy exists in every supported locale',()=>{
  for(const locale of ['en','de','es','fr','ja','ko','pt-BR','ru','zh-CN','zh-TW']) {
    assert.equal(typeof messages(locale).role_read_only,'string');
    assert.ok(messages(locale).role_read_only.length>0);
    if(locale!=='en')assert.notEqual(messages(locale).role_read_only,messages('en').role_read_only);
  }
});

test('populated roles retain native appearance and action targets without an empty state',()=>{
  const setup=fixture(),appearance={icon:'code',color:'blue'};
  setup.view.roles=[{id:'retained',name:'Retained role',key:'review',appearance}];setup.render();
  assert.equal(setup.nodes.has('role-empty'),false);
  assert.deepEqual(plain(setup.nodes.get('role-icon-retained').props),{value:appearance});
  assert.deepEqual(plain(setup.nodes.get('role-edit-retained').props),{icon:'settings-2',label:'Edit',disabled:false});
  assert.deepEqual(plain(setup.nodes.get('role-delete-retained').props),{icon:'circle-x',label:'Delete',disabled:false});
});

test('catalog failures keep the role list without a retry bar',()=>{
  const setup=fixture();setup.view.error='role_failed';
  setup.view.roles=[{id:'retained',name:'Retained role',key:'review',appearance:{icon:'code',color:'blue'}}];
  setup.render();
  assert.equal(setup.nodes.has('role-reload'),false);
  assert.ok(setup.nodes.has('role-edit-retained'));
  assert.ok(setup.nodes.has('role-delete-retained'));
});

test('effort values retain raw names and budgets without changing inheritance',()=>{
  const {effortLabel}=vm.runInNewContext(`${source}\n({effortLabel})`);
  for(const locale of ['en','zh-CN']) {
    const view={text:messages(locale)};
    assert.equal(effortLabel(view,null),view.text.role_effort_inherit);
    for(const raw of ['default','none','minimal','low','medium','high','xhigh','max']) {
      assert.equal(effortLabel(view,raw),raw);
    }
    for(const budget of [-1,1024,8192]) {
      const value={budget};
      assert.equal(effortLabel(view,value),String(budget));
      assert.deepEqual(value,{budget});
    }
  }
});
