import Providers from './providers.js';
import {View,div} from 'gpui-kit';
import {context} from 'sailry';
import {publishContributions,requestProviderHttp,prepareRequest,completeRequest,forgetRequest} from 'sailry/sdk';
import {readModelContext,nextModelContext,toast} from 'sailry/ui';
import {range,decode,metric} from './credits.js';
import {messages} from './locales.js';

export function identity(state) {
  const provider = state.connected ? state.provider : null;
  return provider ? JSON.stringify([provider.id,provider.revision,provider.model,provider.preset]) : null;
}

export default class Footer extends View {
  init(_props,cx) {
    if(JSON.parse(context()).surface==='provider') {
      this.providers=new Providers(cx,messages(JSON.parse(context()).locale));return;
    }
    this.locale = JSON.parse(context()).locale;
    this.text = messages(this.locale);
    this.state = readModelContext(); this.key = identity(this.state);
    this.balance = null; this.pending = null;
    this.publish(); this.refresh(cx); this.ensure(cx);
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
    if (key !== this.key || state.cursor !== this.state.cursor) {this.balance = null;}
    this.state = state; this.key = key;
    this.publish(); this.refresh(cx); this.ensure(cx);
  }

  ensure(cx) {
    const provider = this.state.connected ? this.state.provider : null;
    if (provider?.preset?.id !== 'china') return;
    const key = JSON.stringify([provider.id,provider.revision,provider.preset]);
    if (this.registration === key) return;
    this.registration = key;
    cx.spawn(async () => {
      try {
        const id = prepareRequest({kind:'call_plugin',data:{handler:'register',input:{provider,locale:this.locale}}});
        const result = await completeRequest(id);
        forgetRequest(id);
        if (result.Err) throw new Error(result.Err.message);
      } catch (_) {
        if (this.registration === key) toast({id:'workbuddy-checkin',kind:'error',message:this.text.checkin_failed});
      }
    });
  }

  publish() {
    publishContributions([{id:'credits',visible:!!this.key && this.state.connected && this.balance?.remaining != null,
      ...metric(this.balance,this.text)}]);
  }

  refresh(cx) {
    if ((this.pending?.key === this.key && this.pending.cursor === this.state.cursor) || !this.key || !this.state.connected) return;
    const key = this.key, cursor = this.state.cursor, provider = this.state.provider;
    const pending = {key,cursor};this.pending = pending;
    cx.spawn(async cx => {
      try {
        const response = await requestProviderHttp(provider.id,provider.revision,'credits',range());
        if (this.key !== key || this.state.cursor !== cursor) return;
        this.balance = decode(response);
      } catch (_) {
        if (this.key !== key || this.state.cursor !== cursor) return;
        this.balance = null;
      } finally {
        if(this.pending===pending)this.pending = null;
        this.publish(); cx.notify();
      }
    });
  }

  render() {return div();}
}
