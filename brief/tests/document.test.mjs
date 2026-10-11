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
    append(child) {this.children.push(child);},replaceChildren(...children) {this.children = children;},
    replaceWith(replacement) {this.replacement = replacement;},
    setAttribute() {},addEventListener() {},querySelector() {return {};},
    scrollIntoView() {this.scrolled = true;}};
}

function visual(kind,text) {
  const source = element();source.classList.toggle(kind,true);source.textContent = text;return source;
}

function setup(sections,targets = [],labels = [],visuals = []) {
  const chrome = ['brief','document-toc','document-visual','document-visual-content',
    'document-zoom-in','document-zoom-out','document-visual-close'].map(id => element(id));
  const main = chrome[0],toc = chrome[1],listeners = {},events = [];
  main.querySelectorAll = selector => selector === 'section[data-title]' ? sections
    : selector === 'label' ? labels
    : selector === 'pre.mermaid,pre.chart,pre.math,span.math-inline' ? visuals
    : selector === '[id]' ? [...sections,...targets].filter(item => item.id) : [];
  const document = {
    documentElement:element(),
    getElementById(id) {return chrome.find(item => item.id === id);},
    querySelectorAll() {return [...chrome,...sections,...targets];},
    createElement() {return element();},
    addEventListener(name,handler) {listeners[name] = handler;},
  };
  const window = {mermaid:{initialize() {},async render() {throw Error('Invalid diagram');}},
    MathJax:{startup:{promise:Promise.resolve()},async tex2svgPromise() {throw Error('Invalid formula');}},
    sailryCharts:{render() {throw Error('Invalid chart');}},
    sailryForms:{collect() {throw Error('Invalid form');}},
    sailryDocumentPost:event => events.push(event)};
  vm.runInNewContext(source,{window,document,TextEncoder});
  const click = href => {
    let prevented = false;
    listeners.click({target:{closest() {return {getAttribute() {return href;}};}},
      preventDefault() {prevented = true;}});
    assert(prevented);
  };
  return {toc,click,events,mermaid:window.mermaid,forms:window.sailryForms,
    submit:form => listeners.submit({target:form,preventDefault() {}}),
    retheme:(value = {}) => window.sailryDocument.retheme(value),
    mount:(identity = {}) => window.sailryDocument.mount({
      labels:{contents:'Contents'},identity:{artifact:'document',revision:1,title:'Brief',...identity},
      theme:{},html:'',writable:true,
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

test('visual errors notify once per version and preserve source',async () => {
  const visuals = [visual('mermaid','first'),visual('mermaid','second'),visual('math','formula'),visual('chart','chart')];
  const view = setup([],[],[],visuals);await view.mount();
  assert.equal(view.events.length,1);assert.equal(view.events[0].kind,'render_error');
  assert.equal(view.events[0].artifact,'document');assert.equal(view.events[0].revision,1);
  await view.retheme();await view.mount();
  assert.equal(view.events.length,1);
  for (const source of visuals) {
    assert.equal(source.replacement.children.length,1);
    assert.equal(source.replacement.children[0].textContent,source.textContent);
  }
});

test('new artifact versions receive independent error feedback',async () => {
  const view = setup([],[],[],[visual('mermaid','invalid')]);
  await view.mount();await view.mount({revision:2});await view.mount({artifact:'another',revision:2});
  await view.mount();await view.retheme();
  assert.deepEqual(view.events.map(event => [event.artifact,event.revision]),[['document',1],['document',2],['another',2]]);
});

test('late visual failures cannot notify a newer mount',async () => {
  const source = visual('mermaid','invalid'),view = setup([],[],[],[source]);
  let reject,started;
  const ready = new Promise(resolve => {started = resolve;});
  view.mermaid.render = () => new Promise((_,fail) => {reject = fail;started();});
  const previous = view.mount();await ready;
  const obsolete = source.replacement;
  view.mermaid.render = async () => {throw Error('Invalid diagram');};
  await view.mount({revision:2});reject(Error('Late diagram failure'));await previous;
  assert.equal(obsolete.children.length,0);
  assert.deepEqual(view.events.map(event => event.revision),[2]);
  await view.mount();assert.deepEqual(view.events.map(event => event.revision),[2,1]);
});

test('required forms still report every invalid submission',async () => {
  const view = setup([],[],[],[visual('mermaid','invalid')]);await view.mount();
  const form = {dataset:{name:'questions'}};
  view.forms.collect = () => ({missing:{querySelector() {return {focus() {}};}}});
  view.submit(form);view.submit(form);
  view.forms.collect = () => {throw Error('Invalid form');};
  view.submit(form);view.submit(form);
  assert.deepEqual(view.events.map(event => event.kind),['render_error','required','required','invalid_form','invalid_form']);
});
