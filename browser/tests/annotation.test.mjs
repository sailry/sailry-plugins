import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import {Element,flatten} from '../../tests/elements.mjs';
import {messages,errorKey} from '../dev.sailry.platform/desktop/locales.js';

const source = (await readFile(new URL('../dev.sailry.platform/desktop/annotation.js',import.meta.url),'utf8'))
  .replace(/^import[\s\S]*?from '[^']+';\n/gm,'').replace(/export (class|function) /g,'$1 ');
const page = (await readFile(new URL('../dev.sailry.platform/desktop/view.js',import.meta.url),'utf8'))
  .replace(/^import[\s\S]*?from '[^']+';\n/gm,'').replace(/export function /g,'function ');
const element = {url:'https://example.com',selector:'#heading',text:'Heading',
  bounds:[10,20,100,40],viewport:[1280,800],truncated:false};
const capture = token => ({token,element});

function fixture(submit = async () => {}) {
  const fields = new Map(), released = [], requests = [], notices = [], work = [];
  let serial = 0;
  const api = vm.runInNewContext(`${source}\n${page}\n({Review,reference,renderReview,render})`,{
    div:() => new Element(),Button:Element,Modal:Element,BrowserAnnotationImage:Element,TextField:Element,
    Icon:Element,BrowserSurface:Element,PanelHeader:Element,NavigationTabs:Element,IconButton:Element,
    theme:() => ({colors:{muted_foreground:'theme-muted'}}),
    createText:(value,options) => { const id = `note-${++serial}`; fields.set(id,{value,options}); return id; },
    readText:id => fields.get(id).value,
    releaseText:id => { released.push(id); fields.delete(id); },submitBrowserAnnotation:submit
  });
  const view = {text:messages('en'),state:{annotation:null},
    report:(error,fallback) => notices.push(errorKey(error,fallback)),
    perform:(kind,args) => requests.push({kind,...args})};
  const cx = {notify() {},theme:() => ({typography:{mono:'theme-mono'}}),
    spawn(task) { const result = task(cx); work.push(result); return result; }};
  view.review = new api.Review(view);
  return {...api,view,cx,fields,released,requests,notices,
    accept(token) { view.state.annotation = token ? capture(token) : null; view.review.accept(view.state.annotation); },
    note(value) { fields.get(view.review.current.note).value = value; },
    complete() { return Promise.all(work); }};
}

test('matching captures retain drafts and replacements release text handles', () => {
  const f = fixture(); f.accept('first');
  const note = f.view.review.current.note;
  f.note('Keep the draft'); f.accept('first');
  assert.equal(f.view.review.current.note,note);
  assert.equal(f.fields.get(note).value,'Keep the draft');
  assert.equal(f.fields.get(note).options.multiline,true);
  f.accept('second');
  assert.deepEqual(f.released,[note]);
  assert.equal(f.fields.get(f.view.review.current.note).value,'');
  f.accept(null);
  assert.equal(f.fields.size,0);
  assert.equal(f.view.review.current,null);
});

test('failed submissions retain drafts and retry the original capture', async () => {
  let fail = true; const submitted = [];
  const f = fixture(async (token,value) => {
    submitted.push({token,value}); if (fail) throw new Error('chat_attachment_limit');
  });
  f.accept('original'); f.note('Keep this annotation');
  const note = f.view.review.current.note;
  f.view.review.submit(f.cx); await f.complete();
  assert.equal(f.view.review.pending,false);
  assert.equal(f.view.review.current.note,note);
  assert.equal(f.fields.get(note).value,'Keep this annotation');
  assert.deepEqual(f.notices,['chat_attachment_limit']);
  assert.equal(f.requests.length,0);
  fail = false;
  f.view.review.submit(f.cx); await f.complete();
  assert.deepEqual(submitted.map(item=>item.token),['original','original']);
  assert.deepEqual(JSON.parse(submitted[1].value),{page_element:element,annotation:'Keep this annotation'});
  assert.equal(f.view.review.current,null);
  assert.equal(f.fields.size,0);
  assert.deepEqual(f.requests,[{kind:'cancel_annotation',token:'original'}]);
});

test('pending submissions run once and cannot close newer drafts', async () => {
  let finish, count = 0;
  const f = fixture(() => { count++; return new Promise(resolve => { finish = resolve; }); });
  f.accept('first'); f.note('First draft');
  f.view.review.submit(f.cx); f.view.review.submit(f.cx);
  assert.equal(count,1);
  assert.equal(f.view.review.pending,true);
  f.view.review.close(f.cx);
  assert.deepEqual(f.requests,[{kind:'cancel_annotation',token:'first'}]);
  f.accept('second'); f.note('Second draft');
  finish(); await f.complete();
  assert.equal(f.view.review.current.token,'second');
  assert.equal(f.fields.get(f.view.review.current.note).value,'Second draft');
  assert.equal(f.view.review.pending,false);
  assert.equal(f.requests.length,1);
});

test('invalid notes and stale captures never dispatch', async () => {
  let count = 0; const f = fixture(async () => { count++; });
  f.accept('first'); f.note('x\0y');
  f.view.review.submit(f.cx); await f.complete();
  assert.deepEqual(f.notices,['browser_annotation_invalid']);
  assert.equal(f.view.review.current.token,'first');
  f.note('Valid draft'); f.view.state.annotation = capture('second');
  f.view.review.submit(f.cx); await f.complete();
  assert.equal(count,0);
});

test('references preserve context and enforce the UTF8 byte limit', () => {
  const f = fixture();
  assert.equal(JSON.parse(f.reference(element,'😀'.repeat(1024))).annotation.length,2048);
  assert.throws(()=>f.reference(element,'😀'.repeat(1025)),/browser_annotation_invalid/);
  assert.throws(()=>f.reference(element,'x\0y'),/browser_annotation_invalid/);
  assert.deepEqual(JSON.parse(f.reference(element,'')),{page_element:element,annotation:''});
});

test('review uses a Kit form with private preview and aligned actions', () => {
  const f = fixture(); f.accept('private-capture');
  f.view.review.current.element = {...element,truncated:true};
  const modal = f.renderReview(f.view,f.cx), nodes = flatten(modal);
  assert.equal(modal.props.open,true);
  assert.equal(modal.props.form,true);
  assert.equal(modal.props.width,560);
  assert.ok(nodes.some(node => node?.props?.font_family === 'theme-mono'));
  const preview = nodes.find(node=>node?.props?.id === 'browser-annotation-image');
  assert.deepEqual(preview.props,{id:'browser-annotation-image',token:'private-capture'});
  assert.ok(nodes.some(node=>node?.props?.text_color === 'theme-muted'));
  const footer = modal.items[1];
  assert.ok(Object.hasOwn(footer.props,'justify_end'));
  assert.deepEqual(footer.items.map(node=>node.props.id),['browser-annotation-cancel','browser-annotation-add']);
  assert.ok(Object.hasOwn(footer.items[1].items[0].props,'primary'));
  f.view.review.pending = true;
  const busy = flatten(f.renderReview(f.view,f.cx)).find(node=>node?.props?.id === 'browser-annotation-add' && Object.hasOwn(node.props,'disabled'));
  assert.equal(busy.props.disabled,true); assert.equal(busy.props.loading,true);
  f.accept(null);
  assert.equal(f.renderReview(f.view,f.cx).items.length,0);
});

test('review captions and attachment failures cover every locale', () => {
  for (const locale of ['en','zh-CN','zh-TW','ja','ko','de','fr','es','pt-BR','ru']) {
    const text = messages(locale);
    for (const key of ['browser_annotation','browser_annotation_note','browser_annotation_add',
      'browser_annotation_stale','browser_annotation_invalid','browser_annotation_unavailable',
      'browser_annotation_truncated','settings_cancel','chat_attachment_limit']) assert.ok(text[key],`${locale}: ${key}`);
  }
  assert.equal(errorKey('sailry/ui.submitBrowserAnnotation: chat_attachment_limit'),'chat_attachment_limit');
  assert.equal(errorKey('Unexpected failure','browser_annotation_stale'),'browser_annotation_stale');
});

test('page covers its native surface only while reviewing', () => {
  const f = fixture();
  Object.assign(f.view,{address:'address',selected() { return this.state.tabs[0]; }});
  Object.assign(f.view.state,{selected:1,tabs:[{id:1,url:element.url,title:'Page',loaded:true,loading:false}],
    history:[false,false],supported:true,annotating:false});
  const covered = () => flatten(f.render(f.view,f.cx)).find(node=>node?.props?.id === 'browser-surface').props.covered;
  assert.equal(covered(),false);
  f.accept('selected');
  assert.equal(covered(),true);
  f.view.review.close(f.cx);
  assert.equal(covered(),false);
});
