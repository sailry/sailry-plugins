import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../dev.sailry.platform/document/brief.js',import.meta.url),'utf8');

test('keeps HTML general with optional questions',() => {
  const manifest = JSON.parse(readFileSync(new URL('../plugin.json',import.meta.url),'utf8'));
  const extension = manifest.extensions['dev.sailry.platform'];
  const skill = readFileSync(new URL('../skills/brief/SKILL.md',import.meta.url),'utf8');
  assert.equal(manifest.name,'brief');
  assert.equal(manifest.version,'0.1.0');
  assert.equal(extension.api_version,'v1');
  assert.equal(extension.display.label,'HTML');
  assert(Object.values(extension.display.locales).every(label => label === 'HTML'));
  assert.match(extension.instructions,/explicit HTML or HTML-preview request authorizes generation directly/);
  assert.match(extension.instructions,/Forms are optional/);
  assert.match(skill,/kind=document.*default/);
  assert.match(skill,/kind=preview/);
  assert.match(skill,/Forms are optional/);
  assert.doesNotMatch(skill,/Always end.*form|Finish with a form/);
  for (const declaration of [extension.instructions,skill.replace(/\s+/g,' ')]) {
    assert.match(declaration,/full ordinary plan.*conversation first/);
    assert.match(declaration,/exactly one concise offer/);
    assert.match(declaration,/wait for the user's choice/);
    assert.match(declaration,/Do not repeat the offer for that plan/);
    assert.match(declaration,/Do not offer HTML for pure questions or simple changes/);
    assert.match(declaration,/never generate it automatically without acceptance/);
  }
  assert.deepEqual(extension.tools.slice(0,3).map(tool => tool.name),[
    'write_brief','read_brief','list_briefs',
  ]);
});

test('neutral styling retains the host semantic palette',() => {
  const css = readFileSync(new URL('../dev.sailry.platform/document/brief.css',import.meta.url),'utf8');
  const supplied = new Set(['background','foreground','primary','primary-foreground','secondary',
    'secondary-foreground','muted','muted-foreground','accent','border','success','warning','danger',
    'font-family','font-size','mono-font-family','radius'].map(name => `--document-${name}`));
  const derived = new Set([...css.matchAll(/(--document-[a-z-]+)\s*:/g)].map(match => match[1]));
  for (const name of derived) assert(!supplied.has(name),`Host token was overridden: ${name}`);
  for (const [,name] of css.matchAll(/var\((--document-[a-z-]+)\)/g)) {
    assert(supplied.has(name) || derived.has(name),`Unknown theme token: ${name}`);
  }
  assert.doesNotMatch(css,/:\s*(?:#[0-9a-f]{3,8}\b|(?:oklch|rgba?|hsla?)\(|(?:white|black)\b)/i);
  assert.doesNotMatch(css,/@import|url\(/);
  assert.match(css,/a:focus-visible[^{}]*summary:focus-visible\s*\{[^}]*outline:/);
  assert.match(css,/--document-radius-(?:sm|lg):\s*calc\(var\(--document-radius\)/);
  assert.match(css,/--document-action:\s*var\(--document-foreground\)/);
  assert.match(css,/--document-action-foreground:\s*var\(--document-background\)/);
  assert.match(css,/body\s*\{[^}]*font-size:\s*var\(--document-font-size\)/);
  assert.doesNotMatch(css,/var\(--document-(?:primary|success|warning|danger|accent)\)/);
  for (const [,shadow] of css.matchAll(/box-shadow:\s*([^;]+);/g)) assert.equal(shadow.trim(),'none');
  assert.match(css,/button\s*\{[^}]*min-height:\s*32px[^}]*font-size:\s*\.875em/);
});

test('chrome retains responsive and scroll regions',() => {
  const css = readFileSync(new URL('../dev.sailry.platform/document/brief.css',import.meta.url),'utf8');
  const template = readFileSync(new URL('../dev.sailry.platform/document/template.html',import.meta.url),'utf8');
  const ids = [...template.matchAll(/id="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(ids,['document-sidebar','document-brand','document-title','document-navigation',
    'document-contents','document-toc','brief']);
  assert.match(template,/<details id="document-navigation" open>/);
  assert.doesNotMatch(template,/<(?:script|style)|\son\w+=/);
  for (const selector of ['pre','.document-table','.document-diagram,.document-chart','.document-math']) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    assert.match(css,new RegExp(`(?:^|\\n)${escaped}\\s*\\{[^}]*overflow-x: auto;`));
  }
  assert.match(css,/@media\(max-width:720px\)[^]*#document-sidebar[^]*position: static;/);
  assert.match(css,/@media print[^]*details > \* \{ display: block; \}/);
});

function element(id = '',title) {
  const classes = new Set();
  return {id,dataset:{title},children:[],scrolled:false,style:{setProperty() {}},
    classList:{toggle(name,enabled) {enabled ? classes.add(name) : classes.delete(name);},
      contains(name) {return classes.has(name);}},
    append(child) {this.children.push(child);},replaceChildren(...children) {this.children = children;},
    replaceWith(replacement) {this.replacement = replacement;},
    setAttribute() {},removeAttribute() {},getBoundingClientRect() {return {top:100};},addEventListener() {},querySelector() {return {};},
    scrollIntoView() {this.scrolled = true;}};
}

function visual(kind,text) {
  const source = element();source.classList.toggle(kind,true);source.textContent = text;return source;
}

function setup(sections,targets = [],labels = [],visuals = []) {
  const chrome = ['brief','document-toc','document-title','document-contents'].map(id => element(id));
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
  return {toc,click,events,scroll:() => listeners.scroll(),mermaid:window.mermaid,forms:window.sailryForms,
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

test('the directory highlights the section at the current scroll position',async () => {
  const first = element('first','First'),second = element('second','Second'),view = setup([first,second]);
  await view.mount();assert(view.toc.children[0].classList.contains('active'));
  second.getBoundingClientRect = () => ({top:70});view.scroll();
  assert(view.toc.children[1].classList.contains('active'));assert.equal(view.toc.children[0].classList.contains('active'),false);
  assert.doesNotMatch(source,/document-zoom|showModal|setZoom/);
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

test('visual failures keep source without automatic notifications',async () => {
  const visuals = [visual('mermaid','first'),visual('mermaid','second'),visual('math','formula'),visual('chart','chart')];
  const view = setup([],[],[],visuals);await view.mount();
  assert.equal(view.events.length,0);
  await view.retheme();await view.mount();
  assert.equal(view.events.length,0);
  for (const source of visuals) {
    assert.equal(source.replacement.children.length,1);
    assert.equal(source.replacement.children[0].textContent,source.textContent);
  }
});

test('new artifact versions preserve failed visual source',async () => {
  const source = visual('mermaid','invalid'),view = setup([],[],[],[source]);
  await view.mount();await view.mount({revision:2});await view.mount({artifact:'another',revision:2});
  await view.mount();await view.retheme();
  assert.equal(view.events.length,0);
  assert.equal(source.replacement.children[0].textContent,'invalid');
});

test('late visual failures cannot replace a newer mount',async () => {
  const source = visual('mermaid','invalid'),view = setup([],[],[],[source]);
  let reject,started;
  const ready = new Promise(resolve => {started = resolve;});
  view.mermaid.render = () => new Promise((_,fail) => {reject = fail;started();});
  const previous = view.mount();await ready;
  const obsolete = source.replacement;
  view.mermaid.render = async () => {throw Error('Invalid diagram');};
  await view.mount({revision:2});reject(Error('Late diagram failure'));await previous;
  assert.equal(obsolete.children.length,0);
  assert.equal(source.replacement.children[0].textContent,'invalid');
  assert.equal(view.events.length,0);
  await view.mount();assert.equal(view.events.length,0);
  assert.equal(source.replacement.children[0].textContent,'invalid');
});

test('required forms still report every invalid submission',async () => {
  const view = setup([],[],[],[visual('mermaid','invalid')]);await view.mount();
  const form = {dataset:{name:'questions'}};
  view.forms.collect = () => ({missing:{querySelector() {return {focus() {}};}}});
  view.submit(form);view.submit(form);
  view.forms.collect = () => {throw Error('Invalid form');};
  view.submit(form);view.submit(form);
  assert.deepEqual(view.events.map(event => event.kind),['required','required','invalid_form','invalid_form']);
});
