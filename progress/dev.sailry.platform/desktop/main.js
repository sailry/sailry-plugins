import {View} from 'gpui-kit';
import {context} from 'sailry';
import {nextChange,readActivityCatalog,readActivityPreviews,nextActivityHosts} from 'sailry/sdk';
import {openActivityTarget,modal_closed,nextCardEvent,toast} from 'sailry/ui';
import {State} from './state.js';
import {messages} from './locales.js';
import {render} from './view.js';
import {Floor} from './floor.js';

export default class Workbench extends View {
  init(_props,cx) {
    this.text = messages(JSON.parse(context()).locale);
    this.floor = new Floor();this.dialogOpen = false;this.selected = null;this.targets = new Map();
    this.board = new State(readActivityCatalog,readActivityPreviews,() => {});
    cx.spawn(async cx => {
      try {while (true) {
        const id = await nextCardEvent();
        const item = this.targets.get(id);
        if (item) this.inspect(item,cx);
      }} catch (_) { /* Released controls cannot navigate replacement views. */ }
    });
    cx.spawn(async cx => {
      // Persistent callbacks need the live async context after init returns.
      this.board.changed = () => cx.notify();
      this.board.report = () => toast({id:'activity-read',kind:'error',message:this.text.activity_read_failed});
      await this.board.refresh();
    });
    cx.spawn(async cx => {
      let seen = '';
      try {while (true) {
        const state = await nextChange(seen);seen = state.cursor;
        this.board.connected = state.connected;cx.notify();
        if (state.connected && this.board.visible) await this.board.refresh();
      }} catch (_) { /* Ordinary view release ends observation. */ }
    });
    cx.spawn(async () => {
      let seen = {hosts:[],unread_terminals:[],visible:false};
      try {while (true) {
        seen = await nextActivityHosts(seen);
        if (!seen.visible) this.dialogOpen = false;
        this.board.hosts(seen);
      }}
      catch (_) { /* The shared controller keeps its own notification history. */ }
    });
    cx.spawn(async cx => {
      try {while (true) {
        if (await modal_closed() === 'activity-dialog') this.closeDetails(cx);
      }} catch (_) { /* View release ends modal observation. */ }
    });
  }
  inspect(item,cx) {
    if (item.kind === 'terminal') {openActivityTarget('terminal',item.id);return;}
    this.selected = {kind:'session',id:item.id,title:item.title};this.dialogOpen = true;cx.notify();
  }
  inspectRoom(id,cx) {this.selected = {kind:'room',id};this.dialogOpen = true;cx.notify();}
  inspectApprovals(cx) {this.selected = {kind:'approvals'};this.dialogOpen = true;cx.notify();}
  closeDetails(cx) {this.dialogOpen = false;cx.notify();}
  render(cx) {return render(this,cx);}
}
