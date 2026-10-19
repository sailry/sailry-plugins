import {View,div} from 'gpui-kit';
import {context} from 'sailry';
import {publishContributions,requestProviderHttp,faultCode} from 'sailry/sdk';
import {readModelContext,nextModelContext,toast} from 'sailry/ui';
import * as claude from '../adapters/claude.js';
import * as codex from '../adapters/codex.js';
import {ResponseError} from '../adapters/response.js';
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
    this.text = messages(JSON.parse(context()).locale);
    this.state = readModelContext();this.key = identity(this.state);
    this.snapshot = null;this.pending = false;this.failure = null;this.refreshAt = 0;
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
      this.snapshot = null;this.failure = null;this.refreshAt = 0;
    }
    this.state = state;this.key = key;
    this.publish();this.refresh(cx);
  }

  publish() {
    publishContributions([{id:'usage',visible:!!this.key,...metric(this.snapshot,this.text)}]);
  }

  refresh(cx) {
    if (this.pending || !this.key || Date.now() < this.refreshAt) return;
    const key = this.key,cursor = this.state.cursor,provider = this.state.provider;
    this.pending = true;
    cx.spawn(async cx => {
      try {
        const response = await requestProviderHttp(provider.id,provider.revision,'usage',{});
        if (this.key !== key || this.state.cursor !== cursor) return;
        this.snapshot = adapters[provider.authentication].decode(response);
        this.failure = null;this.refreshAt = Date.now() + 180000;
      } catch (error) {
        if (this.key !== key || this.state.cursor !== cursor) return;
        const code = faultCode(error.message ?? String(error));
        const message = error instanceof ResponseError && error.message ? error.message : this.text.failed;
        const failure = JSON.stringify([code,error.status ?? null,message]);
        if (this.failure !== failure) toast({id:'provider-usage',kind:'error',message});
        this.failure = failure;this.refreshAt = Date.now() + 60000;
      } finally {
        this.pending = false;this.publish();cx.notify();
        if (this.key !== key || this.state.cursor !== cursor) this.refresh(cx);
      }
    });
  }

  render() {return div();}
}
