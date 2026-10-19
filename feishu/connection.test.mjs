import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const manifest = JSON.parse(readFileSync(new URL('./plugin.json', import.meta.url)));
const mcp = JSON.parse(readFileSync(new URL('./mcp.json', import.meta.url)));

test('declares the official remote connection', () => {
  assert.equal(manifest.name, "feishu");
  assert.equal(manifest.extensions['dev.sailry.platform'].api_version, 'v1');
  const server = mcp.mcpServers["feishu"];
  assert.equal(server.type, 'streamable-http');
  assert.equal(server.url, "https://mcp.feishu.cn/mcp");
  assert.equal(server.command, undefined);
  assert.equal(server.args, undefined);
  assert.equal(new URL(server.url).username, '');
});

test('binds credentials outside package resources', () => {
  const schema = JSON.parse(readFileSync(new URL('./dev.sailry.platform/settings.json', import.meta.url)));
  const binding = schema.properties.app_secret['x-sailry-secret'];
  assert.deepEqual(binding, {server:'feishu',header:'X-Lark-MCP-TAT',
    application:{provider:'feishu',client_id:'app_id'}});
  assert.equal(schema.properties.app_id.type, 'string');
  assert.equal(schema.properties.app_id['x-sailry-secret'], undefined);
  assert.equal(schema.properties.app_id.minLength, 1);
  assert.deepEqual(schema.required, ['app_id', 'app_secret']);
  assert.equal(schema.properties.token, undefined);
  assert.equal(mcp.mcpServers["feishu"].headers["X-Lark-MCP-TAT"], '');
  assert.equal(schema.properties.app_secret.default, undefined);
  assert.equal(manifest.extensions['dev.sailry.platform'].oauth, undefined);
});

test('limits the initial tool selection to reads', () => {
  assert.equal(mcp.mcpServers.feishu.headers['X-Lark-MCP-Allowed-Tools'], 'get-comments,fetch-doc');
});

test('localizes publishing and permission guidance', () => {
  const schema = JSON.parse(readFileSync(new URL('./dev.sailry.platform/settings.json', import.meta.url)));
  assert.equal(schema.description, schema['x-sailry-locales'].en.description);
  for (const locale of Object.keys(manifest.extensions['dev.sailry.platform'].display.locales)) {
    const labels = schema['x-sailry-locales'][locale];
    assert.ok(labels.app_id && labels.app_secret, locale);
    assert.equal(labels.description.split('\n').length, 2, locale);
    assert.match(labels.description, /https:\/\/open\.feishu\.cn\/app/);
    assert.match(labels.description, /https:\/\/open\.feishu\.cn\/document\/mcp_open_tools\/supported-tools/);
  }
});

test('declares scoped registration and a package settings page', () => {
  const extension = manifest.extensions['dev.sailry.platform'];
  assert.deepEqual(extension.registration, {provider:'feishu',client_id:'app_id',client_secret:'app_secret',
    tenant_scopes:['docx:document:readonly','docs:document.content:read','docs:document.comment:read']});
  assert.equal(manifest.version, '0.1.4');
  assert.equal(extension.settings_page.entry, 'dev.sailry.platform/desktop/settings.js');
  assert.deepEqual(extension.desktop.resources, [extension.settings_page.entry,'dev.sailry.platform/desktop/locales.js']);
});

function page(locale = 'en') {
  const source = readFileSync(new URL('./dev.sailry.platform/desktop/settings.js', import.meta.url), 'utf8');
  const translations = readFileSync(new URL('./dev.sailry.platform/desktop/locales.js', import.meta.url), 'utf8');
  const tasks = [], notices = [], registrations = [], changes = [];
  let reads = 0, failure = false;
  const node = () => new Proxy({items:[]}, {get(target, key) {
    if (key in target) return target[key];
    return value => {
      if (key === 'child') target.items.push(value);
      else if (key === 'children') target.items.push(...value);
      else target[key] = value;
      return new Proxy(target, this);
    };
  }});
  const control = kind => ({new:(id,props) => ({kind,id,props})});
  const scope = {View:class {},div:node,context:()=>JSON.stringify({locale}),
    theme:()=>({colors:{muted_foreground:'muted'}}),
    InfoAlert:class {constructor(id,message){return node().id(id).child(message);}},
    readSettings:async()=>{++reads; if(failure) throw new Error('read failed');
      return {values:{app_id:'cli_saved'},configured:['app_secret']};},
    nextRegistration:()=>new Promise(resolve=>registrations.push(resolve)),
    nextChange:()=>new Promise(resolve=>changes.push(resolve)),
    RegistrationButton:control('action'),RegistrationQR:control('qr'),ConfigurationButton:control('configuration'),
    SettingsGroup:{new:node},toast:value=>notices.push(value)};
  vm.runInNewContext(translations.replace(/^export /gm,'') + '\nthis.messages = messages;', scope);
  vm.runInNewContext(source.replace(/^import .*$/gm,'').replace('export default class','this.Settings = class'), scope);
  const view = new scope.Settings(), cx = {notify(){},spawn:task=>tasks.push(task(cx))};
  view.init({},cx);
  return {view,cx,notices,tasks,source,registrations,changes,get reads(){return reads;},fail(){failure=true;}};
}

function controls(tree, found = []) {
  if (!tree || typeof tree !== 'object') return found;
  if (tree.kind) found.push(tree);
  for(const child of tree.items ?? []) controls(child,found);
  return found;
}
const flush = () => new Promise(resolve=>setImmediate(resolve));

test('mount observes without initiating registration', async () => {
  const fixture = page(); await flush();
  assert.equal(fixture.reads,1);
  assert.equal(fixture.registrations.length,1);
  assert.equal(fixture.changes.length,1);
  assert.doesNotMatch(fixture.source,/\b(?:prepare|execute|beginRegistration|fetch|open_url)\s*\(/);
  const loading = controls(fixture.view.render());
  assert.equal(loading.find(value=>value.id==='feishu-register').props.disabled,true);
  fixture.registrations.shift()({cursor:'1',phase:'idle',busy:false}); await flush();
  const actions = controls(fixture.view.render());
  assert.deepEqual(JSON.parse(JSON.stringify(actions.find(value=>value.id==='feishu-register').props)),
    {action:'begin',label:'Replace app',replace_pending:false,primary:true,disabled:false});
  assert.equal(actions.find(value=>value.id==='feishu-manual').kind,'configuration');
  assert.ok(!actions.some(value=>value.kind==='qr'));
  assert.equal(fixture.notices.length,0);
});

test('labels configured replacement and first creation', async () => {
  for(const locale of Object.keys(manifest.extensions['dev.sailry.platform'].display.locales)) {
    const fixture = page(locale); await flush();
    fixture.registrations.shift()({cursor:'1',phase:'idle',busy:false}); await flush();
    assert.equal(controls(fixture.view.render()).find(value=>value.id==='feishu-register').props.label,
      fixture.view.text.replace);
    fixture.view.configured = false;
    assert.equal(controls(fixture.view.render()).find(value=>value.id==='feishu-register').props.label,
      fixture.view.text.create);
  }
});

test('composes protected actions and refreshes confirmed settings', async () => {
  const fixture = page(); await flush();
  fixture.registrations.shift()({cursor:'1',phase:'pending',busy:false,can_replace:true,can_open:true}); await flush();
  const actions = controls(fixture.view.render());
  assert.equal(actions.find(value=>value.id==='feishu-register').props.replace_pending,true);
  assert.equal(actions.find(value=>value.id==='feishu-register').props.label,'Refresh');
  assert.equal(actions.find(value=>value.id==='feishu-cancel').props.action,'cancel');
  assert.equal(actions.find(value=>value.id==='feishu-open').props.action,'open');
  assert.equal(actions.find(value=>value.id==='feishu-qr').kind,'qr');
  assert.deepEqual(Object.keys(actions.find(value=>value.id==='feishu-qr').props ?? {}),[]);
  fixture.registrations.shift()({cursor:'failed-cancel',phase:'failed',fault:'permission_denied',busy:false,can_replace:true}); await flush();
  const retained = controls(fixture.view.render()).find(value=>value.id==='feishu-register');
  assert.equal(retained.props.label,'Refresh');
  assert.equal(retained.props.replace_pending,true);
  fixture.registrations.shift()({cursor:'2',phase:'connected',busy:false}); await flush();
  assert.equal(fixture.reads,2);
  assert.equal(fixture.notices.at(-1).message,'App created');
  assert.ok(!controls(fixture.view.render()).some(value=>value.kind==='qr'));
  fixture.changes.shift()({cursor:'1',connected:false}); await flush();
  assert.equal(controls(fixture.view.render()).find(value=>value.id==='feishu-register').props.disabled,true);
});

test('reports uncertain and expired outcomes only as toasts', async () => {
  for(const locale of Object.keys(manifest.extensions['dev.sailry.platform'].display.locales)) {
    const fixture = page(locale); await flush();
    for(const [cursor,phase,fault,key] of [['1','unconfirmed','outcome_unknown','unknown'],
      ['2','failed','expired','expired'],['3','failed','revision_conflict','changed']]) {
      fixture.registrations.shift()({cursor,phase,fault,busy:false}); await flush();
      assert.equal(fixture.notices.at(-1).message,fixture.view.text[key]);
      assert.ok(fixture.notices.at(-1).message.length > 0);
      assert.ok(!JSON.stringify(fixture.view.render()).includes(fixture.view.text[key]));
      if(phase==='unconfirmed') assert.equal(controls(fixture.view.render()).find(value=>value.id==='feishu-register').props.label,fixture.view.text.check);
    }
    fixture.fail();fixture.view.read(fixture.cx);await flush();
    assert.equal(fixture.notices.at(-1).message,fixture.view.text.read_failed);
    assert.equal(fixture.view.configured,true);
  }
});
