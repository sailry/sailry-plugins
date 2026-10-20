import {View,div} from 'gpui-kit';
import {context} from 'sailry';
import {publishContributions,nextContributionEvent} from 'sailry/sdk';
import {readComposer,nextComposerChange,setComposerOption,toast} from 'sailry/ui';
import {messages} from './locales.js';

export default class Composer extends View {
  init(_props,cx) {
    this.text = messages(JSON.parse(context()).locale);
    this.state = readComposer(); this.pending = false;
    this.publish();
    cx.spawn(async cx => {
      try { while (true) {
        this.accept(await nextComposerChange(this.state.cursor));
        this.publish(); cx.notify();
      } } catch (_) { /* The captured contribution owns this observation. */ }
    });
    cx.spawn(async cx => {
      try { while (true) this.change(await nextContributionEvent(),cx); }
      catch (_) { /* Releasing the contribution closes its events. */ }
    });
  }

  accept(state) {
    const left = state.cursor, right = this.state.cursor;
    if (left.length > right.length || left.length === right.length && left >= right) this.state = state;
  }

  enabled() {
    return this.state.connected && !this.state.readonly && !this.state.busy
      && !this.state.configuring && this.state.model_tools && !this.pending
      && this.state.operations?.includes('agents.delegate');
  }

  publish(event) {
    const active = this.state.options?.proactive === true;
    publishContributions([{id:'super',enabled:!!this.enabled(),visible:true,value:active,
      segments:active ? [{label:{label:'Super'},tone:'accent'}] : [],
      ...(event?.id === 'super' ? {reply_to:event.sequence} : {})}]);
  }

  change(event,cx) {
    if (event.id !== 'super') return;
    if (!this.enabled() || event.kind !== 'change' || typeof event.value !== 'boolean') {
      this.publish(event); return;
    }
    const session = this.state.session, cursor = this.state.cursor;
    this.pending = true; this.publish(); cx.notify();
    cx.spawn(async cx => {
      try {
        const state = await setComposerOption(cursor,'plugin',{key:'proactive',value:event.value});
        if (this.state.session === session) this.accept(state);
      } catch (_) {
        if (this.state.session === session) toast({id:'delegation-mode',kind:'error',message:this.text.role_failed});
      } finally { this.pending = false; this.publish(event); cx.notify(); }
    });
  }

  render() { return div(); }
}
