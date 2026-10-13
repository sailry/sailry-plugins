import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('./plugin.json', import.meta.url)));
const mcp = JSON.parse(readFileSync(new URL('./mcp.json', import.meta.url)));
const extension = manifest.extensions['dev.sailry.platform'];
const hostSource = readFileSync(new URL('./dev.sailry.platform/host/connection.js', import.meta.url), 'utf8');
const desktopSource = readFileSync(new URL('./dev.sailry.platform/desktop/connection.js', import.meta.url), 'utf8');
const {fallback, messages} = await import('./dev.sailry.platform/desktop/locales.js');

async function host(configured) {
  const source = hostSource.replace(/^import .*;\s*$/gm, '').replace('export async function connection', 'async function connection');
  const {create} = await import(`data:text/javascript,${encodeURIComponent(`export function create(status,card,fallback){${source}\nreturn connection;}`)}`);
  const reads = [];
  const connection = create(async server => { reads.push(server); return {configured}; }, (key,props,fallback) => ({kind:'card',key,props,fallback}), fallback);
  const result = await connection();
  assert.deepEqual(reads, ['notion']);
  return result;
}

test('declares the official remote connection', () => {
  assert.equal(manifest.name, "notion");
  assert.equal(manifest.extensions['dev.sailry.platform'].api_version, 'v1');
  const server = mcp.mcpServers["notion"];
  assert.equal(server.type, 'streamable-http');
  assert.equal(server.url, "https://mcp.notion.com/mcp");
  assert.equal(server.command, undefined);
  assert.equal(server.args, undefined);
  assert.equal(new URL(server.url).username, '');
});

test('declares a card-only entry with native named targets', () => {
  assert.equal(manifest.version, '0.1.3');
  assert.equal(extension.desktop.entry, undefined);
  assert.equal(extension.desktop.navigation, undefined);
  assert.equal(extension.tools[0].handler.read_only, true);
  assert.equal(extension.tools[0].presentation, 'content');
  const card = extension.cards[0];
  assert.equal(card.key, 'connection');
  assert.equal(card.mcp_server, 'notion');
  assert.ok(extension.desktop.resources.includes(card.entry));
  assert.equal(card.props_schema.additionalProperties, false);
  assert.deepEqual(Object.keys(card.props_schema.properties), ['configured']);
  assert.equal(card.capabilities.qr, undefined, 'Notion does not expose device-QR authorization');
  assert.deepEqual(card.capabilities.browser[0].modes, ['embedded', 'external']);
  assert.deepEqual(card.capabilities.browser[0].source, {kind:'mcp_authorization'});
  assert.ok(card.capabilities.browser[0].origins.includes('https://app.notion.com'));
  assert.ok(card.capabilities.browser[0].origins.every(origin => new URL(origin).origin === origin));
});

test('disconnected status returns a neutral public draft', async () => {
  const result = await host(false);
  assert.equal(result.isError, undefined);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.sailry_content.blocks, [{kind:'card',key:'connection',props:{configured:false},fallback:fallback('connect')}]);
  assert.equal(result.sailry_content.blocks[0].receipt, undefined, 'only Node stamps ownership');
  const connected = await host(true);
  assert.equal(connected.error, undefined);
  assert.equal(connected.isError, undefined);
  assert.equal(connected.sailry_content.blocks[0].props.configured, true);
});

test('mount reads status but login remains a native gesture', async () => {
  const source = desktopSource.replace(/^import .*;\s*$/gm, '').replace('export default class', 'class');
  const {create} = await import(`data:text/javascript,${encodeURIComponent(`export function create(View,div,Attachment,Icon,Action,state,theme,nextChange,status,toast,messages){${source}\nreturn Connection;}`)}`);
  const jobs = [], actions = [], cards = [];
  let statusReads = 0;
  const element = new Proxy({}, {get:() => () => element});
  const NativeAction = {new(id,props) {actions.push({id,...props}); return element;}};
  class NativeAttachment { constructor(id) {cards.push(id); return element;} }
  class NativeIcon { constructor() {return element;} }
  const Connection = create(class {}, () => element, NativeAttachment, NativeIcon, NativeAction,
    () => ({cursor:'0',props:{configured:false},configured:false,login:'idle',can_open:false,can_cancel:false,action:null,locale:'en'}),
    () => ({colors:{}}), async () => {throw new Error('released');}, async () => {statusReads++;}, () => {}, messages);
  const view = new Connection(), cx = {spawn: job => jobs.push(job), notify() {}};
  view.init({}, cx);
  assert.equal(statusReads, 0);
  assert.equal(actions.length, 0);
  await jobs[1](cx);
  assert.equal(statusReads, 1);
  view.render(cx);
  assert.deepEqual(cards, ['notion-connection-card']);
  assert.deepEqual(actions.filter(action => action.action.kind === 'connect').map(action => action.action.mode), ['embedded','external']);
  assert.ok(actions.every(action => action.icon && action.label), 'native icon actions retain accessible labels');
  assert.ok(actions.every(action => !('on_click' in action)), 'package never receives a callable login bridge');
  actions.length = 0; view.state.login = 'pending'; view.state.can_open = true; view.state.can_cancel = true;
  view.render(cx);
  assert.deepEqual(actions.map(action => action.action.kind), ['browser','browser','cancel','refresh']);
  assert.ok(actions.filter(action => action.action.kind === 'browser').every(action => !action.disabled));
  assert.ok(!actions.some(action => action.action.kind === 'connect'), 'reopening preserves the active attempt');
  for (const login of ['unconfirmed','failed']) {
    actions.length = 0; view.state.login = login; view.state.can_open = false;
    view.render(cx);
    assert.deepEqual(actions.map(action => action.action.kind), ['connect','cancel','refresh']);
    assert.deepEqual(actions[0].action, {kind:'connect'}, 'Check resumes the retained attempt');
  }
  actions.length = 0; view.state.login = 'pending'; view.state.can_open = false;
  view.render(cx);
  assert.ok(actions.filter(action => action.action.kind === 'browser').every(action => action.disabled));
  assert.ok(actions.some(action => action.action.kind === 'cancel' && !action.disabled));
});
