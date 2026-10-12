import {View, div} from 'gpui-kit';
import {context} from 'sailry';
import {readSettings, nextChange} from 'sailry/sdk';
import {RegistrationButton, RegistrationQR, nextRegistration} from 'sailry/registration';
import {ConfigurationButton} from 'sailry/forms';
import {SettingsGroup, toast} from 'sailry/ui';
import {messages} from './locales.js';

export default class Settings extends View {
  init(_props, cx) {
    this.text = messages(JSON.parse(context()).locale);
    this.registration = null; this.configured = false; this.connected = true;
    this.reading = false; this.refresh = false; this.notice = null;
    this.read(cx);
    cx.spawn(async cx => {
      let cursor;
      try { while (true) {
        const value = await nextRegistration(cursor); cursor = value.cursor;
        const previous = this.registration?.phase;
        this.registration = value;
        const notice = value.fault ? `${value.phase}:${value.fault}` : null;
        if (notice && notice !== this.notice) {
          const unknown = value.phase === 'unconfirmed' || value.fault === 'outcome_unknown';
          const key = unknown ? 'unknown' : value.fault === 'expired' ? 'expired'
            : value.fault === 'revision_conflict' ? 'changed' : 'failed';
          toast({id:'feishu-registration',message:this.text[key],kind:'error'});
        } else if (value.phase === 'connected' && previous !== 'connected') {
          toast({id:'feishu-registration',message:this.text.created,kind:'success'});
          this.read(cx);
        }
        this.notice = notice; cx.notify();
      } } catch (_) { /* Closing the page releases native observation. */ }
    });
    cx.spawn(async cx => {
      let cursor;
      try { while (true) {
        const change = await nextChange(cursor), first = cursor === undefined;
        cursor = change.cursor; this.connected = change.connected;
        if (!first && change.connected) this.read(cx);
        cx.notify();
      } } catch (_) { /* The mounted page owns its settings subscription. */ }
    });
  }

  read(cx) {
    if (!this.connected) return;
    if (this.reading) { this.refresh = true; return; }
    this.reading = true;
    cx.spawn(async cx => {
      try {
        const value = await readSettings();
        this.configured = typeof value.values.app_id === 'string' && value.values.app_id.length > 0
          && value.configured.includes('app_secret');
      } catch (_) {
        toast({id:'feishu-settings',message:this.text.read_failed,kind:'error'});
      } finally {
        this.reading = false;
        const refresh = this.refresh; this.refresh = false;
        if (refresh) this.read(cx);
        cx.notify();
      }
    });
  }

  render() {
    const state = this.registration, text = this.text;
    const pending = state?.phase === 'pending';
    const busy = !this.connected || this.reading || state?.busy || !state;
    const uncertain = state?.phase === 'unconfirmed';
    const replace = !uncertain && state?.can_replace === true;
    const status = !this.connected ? text.disconnected : this.configured ? text.configured
      : state?.phase === 'starting' || state?.phase === 'exchanging' ? text.waiting : null;
    const controls = div().h_flex().gap_2().flex_wrap()
      .child(RegistrationButton.new('feishu-register',{
        action:'begin',label:uncertain ? text.check : replace ? text.refresh : text.create,
        replace_pending:replace,primary:true,disabled:busy
      }))
      .children(state?.can_replace ? [RegistrationButton.new('feishu-cancel',{
        action:'cancel',label:text.cancel,disabled:busy
      })] : [])
      .children(state?.can_open ? [RegistrationButton.new('feishu-open',{
        action:'open',label:text.open,disabled:busy
      })] : []);
    return div().id('feishu-settings').v_flex().gap_4()
      .child(SettingsGroup.new('feishu-application',{title:text.application})
        .child(div().v_flex().gap_3().py_3()
          .children(status ? [div().id('feishu-status').text_sm().child(status)] : [])
          .children(pending ? [div().v_flex().gap_2()
            .child(div().text_sm().child(text.scan))
            .child(RegistrationQR.new('feishu-qr'))] : [])
          .child(controls)
          .child(div().text_sm().child(text.sharing))
          .child(ConfigurationButton.new('feishu-manual',{
            label:text.manual,disabled:busy
          }))));
  }
}
