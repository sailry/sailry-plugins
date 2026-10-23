import Providers from './providers.js';
import {View,div} from 'gpui-kit';
import {context} from 'sailry';
import {publishContributions,requestProviderHttp} from 'sailry/sdk';
import {readModelContext,nextModelContext} from 'sailry/ui';
import * as claude from '../adapters/claude.js';
import * as codex from '../adapters/codex.js';
import {metric} from './format.js';
import {messages} from './locales.js';

const adapters = {chat_gpt:codex,chat_gpt_oauth:codex,claude_oauth:claude};

export function identity(state) {
  const provider = state.connected ? state.provider : null;
  return provider && Object.hasOwn(adapters,provider.authentication)
    ? JSON.stringify([provider.id,provider.revision,provider.model,provider.authentication,provider.preset]) : null;
}

export default class Footer extends View {
  init(_props,cx) {
    if(JSON.parse(context()).surface==='provider') {
      this.providers=new Providers(cx,messages(JSON.parse(context()).locale));return;
    }
    this.text = messages(JSON.parse(context()).locale);
    this.state = readModelContext();this.key = identity(this.state);
    this.snapshot = null;this.pending = null;this.refreshAt = 0;
    this.publish();this.refresh(cx);
    cx.spawn(async cx => {
      try {while (true) this.accept(await nextModelContext(this.state.cursor),cx);}
      catch (_) { /* Releasing the footer ends its observation. */ }
    });
    // One refresh owner serves every adapter, using the existing view lifetime.
    cx.spawn(async cx => {
      try {while (true) {await cx.sleep(60000);this.refresh(cx);}}
      catch (_) { /* Releasing the footer ends its refresh loop. */ }
    });
  }

  accept(state,cx) {
    const key = identity(state);
    if (key !== this.key || state.cursor !== this.state.cursor) {
      this.snapshot = null;this.refreshAt = 0;
    }
    this.state = state;this.key = key;
    this.publish();this.refresh(cx);
  }

  publish() {
    const measurement = metric(this.snapshot,this.text);
    publishContributions([{id:'usage',visible:!!this.key && measurement.value != null,...measurement}]);
  }

  refresh(cx) {
    if ((this.pending?.key === this.key && this.pending.cursor === this.state.cursor) || !this.key || Date.now() < this.refreshAt) return;
    const key = this.key,cursor = this.state.cursor,provider = this.state.provider;
    const pending = {key,cursor};this.pending = pending;
    cx.spawn(async cx => {
      try {
        const response = await requestProviderHttp(provider.id,provider.revision,'usage',{});
        if (this.key !== key || this.state.cursor !== cursor) return;
        this.snapshot = adapters[provider.authentication].decode(response);
        this.refreshAt = Date.now() + 180000;
      } catch (_) {
        if (this.key !== key || this.state.cursor !== cursor) return;
        this.snapshot = null;this.refreshAt = Date.now() + 60000;
      } finally {
        if(this.pending===pending)this.pending = null;this.publish();cx.notify();
      }
    });
  }

  render() {return div();}
}
