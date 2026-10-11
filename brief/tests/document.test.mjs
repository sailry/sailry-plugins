import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../dev.sailry.platform/document/brief.js',import.meta.url),'utf8');

function element(id = '',title) {
  const classes = new Set();
  return {id,dataset:{title},children:[],scrolled:false,style:{setProperty() {}},
    classList:{toggle(name,enabled) {enabled ? classes.add(name) : classes.delete(name);},
      contains(name) {return classes.has(name);}},
    append(child) {this.children.push(child);},replaceChildren() {this.children = [];},
    setAttribute() {},addEventListener() {},querySelector() {return {};},
    scrollIntoView() {this.scrolled = true;}};
}

function setup(sections,targets = [],labels = []) {
  const chrome = ['brief','document-toc','document-visual','document-visual-content',
    'document-zoom-in','document-zoom-out','document-visual-close'].map(id => element(id));
  const main = chrome[0],toc = chrome[1],listeners = {};
  main.querySelectorAll = selector => selector === 'section[data-title]' ? sections
    : selector === 'label' ? labels
    : selector === '[id]' ? [...sections,...targets].filter(item => item.id) : [];
  const document = {
    documentElement:element(),
    getElementById(id) {return chrome.find(item => item.id === id);},
    querySelectorAll() {return [...chrome,...sections,...targets];},
    createElement() {return element();},
    addEventListener(name,handler) {listeners[name] = handler;},
  };
  const window = {mermaid:{initialize() {}}};
  vm.runInNewContext(source,{window,document,TextEncoder});
  const click = href => {
    let prevented = false;
    listeners.click({target:{closest() {return {getAttribute() {return href;}};}},
      preventDefault() {prevented = true;}});
    assert(prevented);
  };
  return {toc,click,mount:() => window.sailryDocument.mount({
    labels:{contents:'Contents'},identity:{title:'Brief'},theme:{},html:'',writable:true,
  })};
}

test('authored section anchors survive mounting and encoded navigation',async () => {
  const section = element('choices 中文','Choices'),view = setup([section]);
  await view.mount();
  assert.equal(section.id,'choices 中文');
  assert.equal(view.toc.children[0].href,'#choices%20%E4%B8%AD%E6%96%87');
  view.click(view.toc.children[0].href);assert(section.scrolled);
});

test('generated anchors avoid document and authored target collisions',async () => {
  const unnamed = element('','New'),authored = element('document-section-1','Existing');
  const view = setup([unnamed,authored],[element('document-section-0')]);
  await view.mount();
  assert.equal(unnamed.id,'document-section-2');
  assert.equal(authored.id,'document-section-1');
  assert.deepEqual(view.toc.children.map(link => link.href),['#document-section-2','#document-section-1']);
});

test('fragment links target owned content and tolerate literal percent signs',async () => {
  const owned = element('document-visual'),literal = element('%invalid');
  const view = setup([],[owned,literal]);await view.mount();
  view.click('#document-visual');assert(owned.scrolled);
  view.click('#%invalid');assert(literal.scrolled);
});

test('form labels align only direct inputs and selects',async () => {
  const input = element(),select = element(),textarea = element(),plain = element(),wrapped = element();
  input.children = [{tagName:'INPUT'}];select.children = [{tagName:'SELECT'}];
  textarea.children = [{tagName:'TEXTAREA'}];wrapped.children = [{tagName:'SPAN',children:[{tagName:'INPUT'}]}];
  const labels = [input,select,textarea,plain,wrapped];
  const view = setup([],[],labels);await view.mount();
  assert.deepEqual(labels.map(label => label.classList.contains('document-control')),[true,true,false,false,false]);
});
