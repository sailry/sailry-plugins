import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=(await readFile(new URL('../dev.sailry.platform/desktop/view.js',import.meta.url),'utf8'))
  .replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const plain=value=>JSON.parse(JSON.stringify(value));
function element(id,props={}) {
  return {id,props,items:[],children(items){this.items.push(...items);return this;},
    size(){return this;},label(){return this;},ghost(){return this;},
    disabled(value){this.disabledValue=value;return this;},on_click(action){this.action=action;return this;}};
}
const {render}=vm.runInNewContext(`${source}\n({render})`,{
  Button:function(id){return element(id);},StatusList:{new:element},
});
function view(goal=null) {
  return {goal,text:{empty:'No goal',retry:'Retry',stop:'Stop',resume:'Resume',clear:'Clear'},
    state:{connected:true,readonly:false,mode:'code'},busy:false,loading:false,draft:()=>'',perform(){}};
}

test('description preserves source without indented status rows',()=>{
  const setup=view({description:'First 中文 🙂\r\n\n  Second  ',state:'active'});
  const panel=render(setup);
  assert.equal(panel.id,'goal-description');
  assert.deepEqual(plain(panel.props.items),[]);
  assert.equal(panel.props.body,setup.goal.description);
  assert.deepEqual(panel.items.map(item=>item.id),['goal-stop','goal-clear']);
});

test('states and draft content remain plugin policy',()=>{
  for(const state of ['pending','completed','paused','blocked','failed']) {
    const setup=view({description:'Goal',state});
    const panel=render(setup);
    assert.deepEqual(plain(panel.props.items),[]);
    assert.equal(panel.props.body,'Goal');
    assert.equal(panel.items.some(item=>item.id==='goal-resume'),['paused','blocked','failed'].includes(state));
  }
  const setup=view();setup.draft=()=>'/literal content';
  assert.equal(render(setup).props.body,'/literal content');
  setup.draft=()=>'';
  assert.deepEqual(plain(render(setup).props.items),[]);
  assert.equal(render(setup).props.body,undefined);
});

test('long Unicode descriptions are not truncated',()=>{
  const description='中文🙂'.repeat(1000);
  const setup=view({description,state:'paused'});
  assert.equal(render(setup).props.body,description);
  setup.goal.description=Array.from({length:300},(_,index)=>`Line ${index}`).join('\n');
  assert.equal(render(setup).props.body,setup.goal.description);
  assert.deepEqual(plain(render(setup).props.items),[]);
});

test('read failures preserve goals without retry bars; pending actions remain recoverable',()=>{
  const setup=view({description:'Retained goal',state:'active'});
  setup.readFailed=true;
  assert.deepEqual(render(setup).items.map(item=>item.id),['goal-stop','goal-clear']);
  setup.pending={id:'original-request'};
  assert.ok(render(setup).items.some(item=>item.id==='goal-retry'));
});

test('refresh disables controls while preserving source content',()=>{
  for(const state of ['active','paused']) {
    const setup=view({description:'Retained goal',state});
    setup.loading=true;
    assert.equal(render(setup).props.body,'Retained goal');
    assert.ok(render(setup).items.every(item=>item.disabledValue===true));
    setup.pending={id:'original-request'};
    assert.ok(render(setup).items.every(item=>item.disabledValue===true));
  }
});
