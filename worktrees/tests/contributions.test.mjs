import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {Controller} from '../dev.sailry.platform/desktop/controller.js';
import {messages} from '../dev.sailry.platform/desktop/locales.js';

const source=readFileSync(new URL('../dev.sailry.platform/desktop/main.js',import.meta.url),'utf8')
  .replace(/^import[\s\S]*?;\n/gm,'').replace('export default class Worktrees','class Worktrees');
function fixture(location) {
  const published=[];
  const names=['selectLocation','readWorktreeCatalog','listWorktrees','inspectGit','resolveGitRevision',
    'prepareWorktreeChange','prepareGitChange','completeRequest','forgetRequest','newId','worktreeHasDrafts',
    'releaseWorktree','toast','nextLocationChange','nextContributionEvent','nextPickerEvent','modal_closed',
    'nextTextEvent','nextToastEvent','createText','readText','releaseText','focusText','dismissToast'];
  const bindings=Object.fromEntries(names.map(name=>[name,()=>{}]));
  const Worktrees=vm.runInNewContext(`${source}\nWorktrees`,{
    ...bindings,View:class {},Controller,messages,render:()=>{},context:()=>JSON.stringify({locale:'en'}),
    readLocation:()=>location,publishContributions:states=>published.push(states),
  });
  const view=new Worktrees();
  view.init({}, {spawn:()=>{}});
  return {view,published};
}
const base={project:'project',project_name:'Project',branch:'main',main:true,can_move:true,git:true,session:null};

test('initialization keeps declared labels for unrepresentable names',()=>{
  for (const main of [false,true]) for (const name of [null,undefined,'','   ','\u2003','line\nbreak',
    '\u0085','a'.repeat(129),'中文'.repeat(22),'🙂'.repeat(33)]) {
    const location={...base,main,project_name:name,branch:name};
    const {view,published}=fixture(location);
    assert.equal(published.length,1);
    assert.equal(published[0][0].label,undefined);
    assert.equal(view.model.location,location);
    assert.equal(location[main ? 'project_name' : 'branch'],name);
    assert.deepEqual(Array.from(published[0],state=>state.id),['location','manage','create','fork']);
  }
});

test('valid UTF-8 labels and captured replies remain intact',()=>{
  for (const name of ['a'.repeat(128),'中文'.repeat(21),'🙂'.repeat(32),'e\u0301','\ufeff']) {
    const {view,published}=fixture({...base,main:false,branch:name});
    assert.equal(published[0][0].label.label,name);
    view.publish({id:'location',sequence:7});
    assert.equal(published[1][0].reply_to,7);
    assert.equal(published[1][1].reply_to,undefined);
    assert.equal(published[1][0].enabled,true);
  }
});

test('no-project labels and disabled context preserve scope',()=>{
  const {published}=fixture({...base,project:null,session:'session',can_move:false});
  assert.equal(published[0][0].label.label,'No project');
  assert.equal(published[0][0].enabled,false);
  assert.equal(published[0][1].visible,false);
  assert.equal(published[0][2].visible,false);
  assert.equal(published[0][3].visible,false);
});
