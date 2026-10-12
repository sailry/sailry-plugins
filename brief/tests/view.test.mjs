import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {Element,flatten} from '../../tests/elements.mjs';
import {messages,locales} from '../dev.sailry.platform/desktop/locales.js';
import {Controller} from '../dev.sailry.platform/desktop/controller.js';

const source = readFileSync(new URL('../dev.sailry.platform/desktop/view.js',import.meta.url),'utf8')
  .replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const {render} = vm.runInNewContext(`${source}\n({render})`,{
  div:() => new Element(),Header:Element,Picker:Element,IconButton:Element,Loading:Element,ArtifactSurface:Element,
});
function setup() {
  const state = new Controller({}, {id:'artifact',session:'session'}, () => {}, () => {});
  state.artifact = {id:'artifact',revision:2,title:'Brief title'};state.revision = 2;state.items = [{revision:2},{revision:1}];
  return {state,text:messages('zh-CN')};
}
const find = (view,id) => flatten(render(view)).find(item => item instanceof Element && item.props.id === id);

test('panel header owns version selection and the export action',() => {
  const view = setup(),header = JSON.parse(find(view,'brief-header').props.content),menu = find(view,'brief-export-picker');
  assert.equal(header.filters[0].selected,'2');assert.equal(header.filters[0].label,'版本');assert.equal(header.actions[0].icon,'icons/ellipsis-vertical.svg');
  assert.deepEqual(JSON.parse(JSON.stringify(menu.props.items)),[
    {id:'brief-export-html',label:'HTML',disabled:false,value:{format:'html'}},{id:'brief-export-image',label:'图片',disabled:false,value:{format:'png'}},
  ]);
  const surface = find(view,'brief-preview-artifact');assert.equal(surface.props.artifact,'artifact');assert.equal(surface.props.revision,undefined);
  view.state.follow = false;assert.equal(find(view,'brief-preview-artifact').props.revision,2);
  assert.equal(surface.props.labels.submit,'提交');
});
test('header actions use complete bundled icon paths',() => {
  const view = setup();view.state.before = 1;
  const header = JSON.parse(find(view,'brief-header').props.content);
  assert.deepEqual(header.actions.map(({id,icon}) => ({id,icon})),[
    {id:'brief-more-versions',icon:'icons/ellipsis.svg'},
    {id:'brief-export',icon:'icons/ellipsis-vertical.svg'},
  ]);
});
test('interactive previews offer only HTML export',() => {
  const view = setup();view.state.artifact.kind = 'preview';
  const menu = find(view,'brief-export-picker');
  assert.deepEqual(JSON.parse(JSON.stringify(menu.props.items)),[
    {id:'brief-export-html',label:'HTML',disabled:false,value:{format:'html'}},
  ]);
  assert(find(view,'brief-preview-artifact'));
  assert.equal(JSON.parse(find(view,'brief-header').props.content).filters[0].selected,'2');
});
test('refresh keeps the preview and disables actions without loading text',() => {
  const view = setup();view.state.loading = true;
  assert(find(view,'brief-preview-artifact'));assert.equal(JSON.parse(find(view,'brief-header').props.content).actions[0].disabled,true);
  view.state.artifact = null;const loader = find(view,'brief-loading');assert(loader);assert.equal(loader.props.label,undefined);
});
test('unavailable reads show a retry control without repeating error feedback',() => {
  const view = setup();view.state.artifact = null;view.state.failed = true;
  assert.equal(find(view,'brief-retry').props.label,'重试');assert.equal(find(view,'brief-preview-artifact'),undefined);
});
test('all ten locales have the complete concise form and panel vocabulary',() => {
  assert.equal(Object.keys(locales).length,10);
  for (const [locale,values] of Object.entries(locales)) {
    assert.deepEqual(Object.keys(values),Object.keys(locales.en),locale);
    assert(Object.values(values).every(value => typeof value === 'string' && value && !/[.。]$/.test(value)),locale);
  }
  assert.equal(messages('unknown'),locales.en);
});
