import {View,div} from 'gpui-kit';
import {context} from 'sailry';
import {publishContributions,requestProviderHttp,faultCode} from 'sailry/sdk';
import {readModelContext,nextModelContext,toast} from 'sailry/ui';
import {range,decode,metric,ResponseError} from './credits.js';
import {messages} from './locales.js';

export function identity(state) {
  const provider = state.connected ? state.provider : null;
  return provider ? JSON.stringify([provider.id,provider.revision,provider.model,provider.preset]) : null;
}

export default class Footer extends View {
  init(_props,cx) {
    this.text = messages(JSON.parse(context()).locale);
    this.state = readModelContext(); this.key = identity(this.state);
    this.balance = null; this.pending = false; this.failure = null;
    this.publish(); this.refresh(cx);
    cx.spawn(async cx => {
      try {while (true) this.accept(await nextModelContext(this.state.cursor),cx);}
      catch (_) { /* The captured footer owns its observation. */ }
    });
    cx.spawn(async cx => {
      try {while (true) {await cx.sleep(60000);this.refresh(cx);}}
      catch (_) { /* Releasing the footer ends its refresh loop. */ }
    });
  }

  accept(state,cx) {
    const key = identity(state);
    if (key !== this.key || state.cursor !== this.state.cursor) {this.balance = null;this.failure = null;}
    this.state = state; this.key = key;
    this.publish(); this.refresh(cx);
  }

  publish() {
    publishContributions([{id:'credits',visible:!!this.key && this.state.connected,
      ...metric(this.balance,this.text)}]);
  }

  refresh(cx) {
    if (this.pending || !this.key || !this.state.connected) return;
    const key = this.key, cursor = this.state.cursor, provider = this.state.provider;
    this.pending = true;
    cx.spawn(async cx => {
      try {
        const response = await requestProviderHttp(provider.id,provider.revision,'credits',range());
        if (this.key !== key || this.state.cursor !== cursor) return;
        this.balance = decode(response); this.failure = null;
      } catch (error) {
        if (this.key !== key || this.state.cursor !== cursor) return;
        const code = faultCode(error.message ?? String(error));
        const message = error instanceof ResponseError && error.message ? error.message
          : this.text[code === 'permission_denied' || code === 'not_configured' ? 'permission' : 'failed'];
        const failure = JSON.stringify([code,message]);
        if (this.failure !== failure) toast({id:'workbuddy-credits',kind:'error',message});
        this.balance = null; this.failure = failure;
      } finally {
        this.pending = false;
        this.publish(); cx.notify();
        if (this.key !== key || this.state.cursor !== cursor) this.refresh(cx);
      }
    });
  }

  render() {return div();}
}
