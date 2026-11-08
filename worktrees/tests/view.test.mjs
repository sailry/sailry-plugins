import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source = (await readFile(new URL('../dev.sailry.platform/desktop/view.js',import.meta.url),'utf8'))
  .replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const element = new Proxy({}, {get:() => () => element});
let checkbox;
let modal;
const buttons=[];
// The pinned component-shell contract exposes semantic size and boolean changes.
class Checkbox {
  constructor(id) {this.id=id;checkbox=this;}
  size(value) {assert(['xsmall','small','medium','large'].includes(value));this.controlSize=value;return this;}
  label(value) {this.text=value;return this;}
  checked(value) {assert.equal(typeof value,'boolean');this.value=value;return this;}
  disabled(value) {this.readonly=value;return this;}
  on_change(callback) {this.change=callback;return this;}
}
const {render} = vm.runInNewContext(`${source}\n({render})`, {
  div:() => element,
  Button:class {
    constructor(id) {
      const props={id};buttons.push(props);
      const control=new Proxy(props,{get:(_target,key)=>value=>{props[key]=value;return control;}});
      return control;
    }
  },
  Icon:class {constructor(){return element;}},
  Separator:class {constructor(){return element;}},
  list:(_id,count,_key,render) => {for(let index=0;index<count;index++)render(index);return element;},
  Field:class {constructor(){return element;}},
  Form:class {constructor(){return element;}},
  Checkbox,
  TextField:{new:() => element},
  window:{viewport_size:() => ({width:800,height:600})},
  Modal:{new:(_,props) => {
    modal={props,items:[]};
    return new Proxy(modal,{get:(target,key) => key==='child' ? child=>{target.items.push(child);return element;}
      : key==='children' ? children=>{target.items.push(...children);return element;} : target[key]});
  }},
});

test('management rows retain disabled and pending state', () => {
  const owner = {kind:'list',token:'picker',pending:false,loading:false,
    choices:[{id:'available',label:'Available'},{id:'locked',label:'Locked',disabled:true}]};
  render({model:{dialog:owner},text:key => key});
  assert.equal(modal.props.open,true);
  assert.equal(modal.props.title,'worktree_manage');
  const rows=()=>buttons.filter(button=>['worktree-available','worktree-locked'].includes(button.id)).slice(-2);
  assert.deepEqual(rows().map(button=>button.disabled),[false,true]);
  owner.pending=true;
  render({model:{dialog:owner},text:key => key});
  assert.equal(modal.props.open,true);
  assert.deepEqual(rows().map(button=>button.disabled),[true,true]);
});

test('managed checkbox uses semantic size and boolean changes', () => {
  const owner={kind:'managed',token:'managed',pending:false,request:null,status:{},fields:{branch:'branch'},include_changes:true};
  const view={model:{dialog:owner},text:key => key};let notifications=0;
  render(view);
  assert.equal(checkbox.id,'location-copy-changes');assert.equal(checkbox.controlSize,'small');
  assert.equal(checkbox.value,true);assert.equal(checkbox.readonly,false);
  checkbox.change(false,{notify:()=>{notifications++;}});assert.equal(owner.include_changes,false);
  render(view);assert.equal(checkbox.value,false);
  checkbox.change(true,{notify:()=>{notifications++;}});assert.equal(owner.include_changes,true);
  assert.equal(notifications,2);
});

test('managed checkbox preserves readonly state', () => {
  for (const pending of [false,true]) {
    const owner={kind:'managed',token:'managed',pending,request:pending ? null : 'admitted',status:{},fields:{branch:'branch'},include_changes:true};
    render({model:{dialog:owner},text:key => key});assert.equal(checkbox.readonly,true);
    checkbox.change(false,{notify:()=>{assert.fail('readonly control notified');}});
    assert.equal(owner.include_changes,true);
  }
});

test('ordinary worktree dialogs use modal titles and body footer slots',()=>{
  for(const [owner,title,width] of [
    [{kind:'create',token:'create',pending:false,uncertain:false,fields:{revision:'revision',branch:'branch',path:'path'}},'worktree_create',488],
    [{kind:'managed',token:'managed',pending:false,request:null,status:{},fields:{branch:'branch'},include_changes:false,fork:true},'location_fork',448],
    [{kind:'remove',token:'remove',pending:false,request:null,entry:{path:'/retained'}},'worktree_remove',448],
  ]) {
    render({model:{dialog:owner},text:key=>key});
    assert.deepEqual({...modal.props},{open:true,form:true,title,width});
    assert.equal(modal.items.length,2);
  }
});
