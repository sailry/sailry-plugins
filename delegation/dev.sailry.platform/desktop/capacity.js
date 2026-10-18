// The package owns its configuration; Node owns scheduling and durable receipts.
import {readSettings,completeRequest,forgetRequest,faultCode} from 'sailry/sdk';
import {prepareSettings} from 'sailry/settings';
import {createText,readText,setText} from 'sailry/forms';
import {toast} from 'sailry/ui';

export function count(value) {
  const text = value.trim();
  if (!/^[0-9]+$/.test(text)) throw new Error('capacity_invalid');
  const number = BigInt(text);
  if (number < 1n || number > 18446744073709551615n) throw new Error('capacity_invalid');
  return number.toString();
}

export class Capacity {
  constructor(text) {
    this.text = text; this.saved = null; this.request = null;
    this.serial = 0; this.pending = false; this.loading = false; this.dirty = false; this.connected = true;
    this.field = createText('',{label:text.child_concurrency});
  }

  locked() { return !this.connected || !this.saved || !!this.request; }

  load(cx) {
    if (this.loading || this.request) return;
    this.loading = true;
    const serial = this.serial;
    cx.spawn(async cx => {
      try {
        const value = await readSettings();
        if (!this.request && serial === this.serial) {
          this.saved = value;
          if (!this.dirty) setText(this.field,value.values.child_concurrency);
        }
      } catch (_) { this.fail('role_failed'); }
      finally { this.loading = false; cx.notify(); }
    });
  }

  input(event,cx) {
    if (event.kind === 'focus' && !this.saved) this.load(cx);
    if (event.kind === 'change' && !this.request) this.dirty = true;
    if (event.kind === 'blur' || event.kind === 'enter') this.save(cx);
  }

  fail(key) { toast({id:'delegation-capacity',message:this.text[key],kind:'error'}); }

  save(cx) {
    if (this.pending || !this.connected || !this.saved) return;
    if (!this.request) {
      let value;
      try {
        value = count(readText(this.field));
      } catch (_) { this.fail('capacity_invalid'); return; }
      if (value === this.saved.values.child_concurrency) { this.dirty = false; return; }
      try {
        this.serial += 1;
        this.request = prepareSettings({...this.saved.values,child_concurrency:value},{},
          String(this.saved.package.settings_revision));
      } catch (error) {
        this.fail(faultCode(error.message ?? String(error)) === 'revision_conflict' ? 'role_conflict' : 'role_unknown');
        return;
      }
    }
    const request = this.request;
    this.pending = true; cx.notify();
    cx.spawn(async cx => {
      try {
        const result = await completeRequest(request);
        if (result.Ok?.kind === 'plugin_settings') {
          this.saved = result.Ok.data; this.dirty = false;
          setText(this.field,this.saved.values.child_concurrency);
          forgetRequest(request); this.request = null;
          toast({id:'delegation-capacity',message:this.text.settings_saved,kind:'success'});
        } else {
          const code = result.Err?.code;
          this.fail(code === 'revision_conflict' ? 'role_conflict' : 'role_unknown');
          if (code && !['outcome_unknown','unavailable','cancelled'].includes(code)) {
            forgetRequest(request); this.request = null;
            this.load(cx);
          }
        }
      } catch (error) {
        this.fail(faultCode(error.message ?? String(error)) === 'revision_conflict' ? 'role_conflict' : 'role_unknown');
      } finally { this.pending = false; cx.notify(); }
    });
  }
}
