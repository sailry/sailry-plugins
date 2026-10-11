import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {Element,flatten} from '../../tests/elements.mjs';
import {Controller} from '../dev.sailry.platform/desktop/controller.js';
import {messages} from '../dev.sailry.platform/desktop/locales.js';

const content=revision=>({artifact:{id:'artifact',title:'Captured document',revision}});
const source=name=>readFileSync(new URL(`../dev.sailry.platform/desktop/${name}.js`,import.meta.url),'utf8')
  .replace(/^import .*;\n/gm,'');
const render=vm.runInNewContext(`${source('view').replace(/^export /gm,'')}\nrender`,{
  div:()=>new Element(),Header:Element,Picker:Element,IconButton:Element,Loading:Element,ArtifactSurface:Element,
});
const idle=()=>new Promise(()=>{});
const settle=()=>new Promise(done=>setImmediate(done));

function fixture(read) {
  const reads=[],waiting=[],queued=[];
  const next=()=>queued.length?Promise.resolve(queued.shift()):new Promise(done=>waiting.push(done));
  const artifacts={
    artifactResource:()=>({id:'artifact',session:'session'}),
    readArtifact:(id,revision)=>{reads.push(revision);return read(id,revision);},
    listArtifactRevisions:async()=>({items:[{revision:2},{revision:1}],next_before:null}),
    nextArtifactChange:idle,nextArtifactEvent:next,
  };
  const Brief=vm.runInNewContext(`${source('main').replace('export default class Brief','class Brief')}\nBrief`,{
    View:class{},Controller,messages,render,artifacts,context:()=>JSON.stringify({locale:'en'}),
    header_action:idle,nextControlEvent:idle,nextPickerEvent:idle,toast:()=>{},
  });
  const view=new Brief(),errors=[];
  const cx={notify(){},spawn:callback=>callback(cx).catch(error=>errors.push(error))};
  view.init({},cx);
  return {view,reads,errors,send(event){const resolve=waiting.shift();if(resolve)resolve(event);else queued.push(event);}};
}

function header(view) {
  const element=flatten(view.render()).find(element=>element.props.id==='brief-header');
  return JSON.parse(element.props.content);
}
function surface(view) {
  return flatten(view.render()).find(element=>element.props.id==='brief-preview-artifact');
}

test('a restored edit pins header and surface before its captured read returns',async()=>{
  let restore;
  const owner=fixture(read);
  function read(_id,revision){
    return revision===1?new Promise(done=>{restore=()=>done(content(1));}):Promise.resolve(content(2));
  }
  await settle();assert.equal(header(owner.view).filters[0].selected,'2');
  owner.send({kind:'edited',artifact:'other',revision:1});await settle();
  assert.deepEqual(owner.reads,[undefined]);assert.equal(owner.view.state.follow,true);
  owner.send({kind:'edited',artifact:'artifact',revision:1});await settle();
  assert.equal(header(owner.view).filters[0].selected,'1');
  assert.equal(surface(owner.view).props.revision,1);
  assert.equal(owner.view.state.artifact.revision,2,'the prior read remains visible until restoration completes');
  restore();await settle();
  assert.equal(owner.view.state.artifact.revision,1);assert.equal(owner.view.state.follow,false);
  assert.deepEqual(owner.reads,[undefined,1]);assert.deepEqual(owner.errors,[]);
  owner.view.release();
});

test('a restored edit supersedes the initial latest read',async()=>{
  let initial;
  const owner=fixture((_id,revision)=>revision===undefined
    ?new Promise(done=>{initial=()=>done(content(2));}):Promise.resolve(content(revision)));
  owner.send({kind:'edited',artifact:'artifact',revision:1});await settle();
  assert.equal(header(owner.view).filters[0].selected,'1');assert.equal(owner.view.state.follow,false);
  initial();await settle();
  assert.equal(owner.view.state.artifact.revision,1);assert.equal(header(owner.view).filters[0].selected,'1');
  assert.equal(surface(owner.view).props.revision,1);assert.deepEqual(owner.reads,[undefined,1]);
  assert.deepEqual(owner.errors,[]);owner.view.release();
});
