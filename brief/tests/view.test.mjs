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
  div:() => new Element(),PanelHeader:Element,SelectField:Element,Menu:Element,IconButton:Element,Loading:Element,ArtifactSurface:Element,
});
function setup() {
  const state = new Controller({}, {id:'artifact',session:'session'}, () => {}, () => {});
  state.artifact = {id:'artifact',revision:2,title:'Brief title'};state.revision = 2;state.items = [{revision:2},{revision:1}];
  return {state,text:messages('zh-CN')};
}
const find = (view,id) => flatten(render(view)).find(item => item instanceof Element && item.props.id === id);

test('panel owns native version selection and an icon-free export menu',() => {
  const view = setup(),picker = find(view,'brief-version'),menu = find(view,'brief-export');
  assert.equal(picker.props.selected,'2');assert.equal(picker.props.label,'版本');assert.equal(menu.props.icon,'ellipsis-vertical');
  assert.deepEqual(JSON.parse(JSON.stringify(menu.props.items)),[
    {id:'brief-export-html',label:'HTML',value:{format:'html'}},{id:'brief-export-image',label:'图片',value:{format:'png'}},
  ]);
  const surface = find(view,'brief-preview-artifact');assert.equal(surface.props.artifact,'artifact');assert.equal(surface.props.revision,undefined);
  view.state.follow = false;assert.equal(find(view,'brief-preview-artifact').props.revision,2);
  assert.equal(surface.props.labels.submit,'提交');
});
test('refresh keeps the preview and disables actions without loading text',() => {
  const view = setup();view.state.loading = true;
  assert(find(view,'brief-preview-artifact'));assert.equal(find(view,'brief-export').props.disabled,true);
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
