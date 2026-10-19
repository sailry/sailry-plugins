// The package owns its configuration; Node owns scheduling and durable receipts.
import {readSettings,completeRequest,forgetRequest,faultCode} from 'sailry/sdk';
import {prepareSettings} from 'sailry/settings';
import {createSlider,setSlider} from 'sailry/forms';
import {toast} from 'sailry/ui';

export function count(value) {
  const text = value.trim();
  if (!/^[0-9]+$/.test(text)) throw new Error('capacity_invalid');
  const number = BigInt(text);
  if (number < 1n || number > 18446744073709551615n) throw new Error('capacity_invalid');
  return number.toString();
}

export class Capacity {
  constructor(text,settled = () => {}) {
    this.text = text; this.saved = null; this.request = null; this.settled = settled;
    this.value = null;
    this.serial = 0; this.pending = false; this.loading = false; this.dirty = false; this.connected = true;
    this.field = createSlider(8,{min:1,max:50,step:1,label:text.child_concurrency});
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
          if (!this.dirty) this.adopt(value.values.child_concurrency);
        }
      } catch (_) { this.fail('role_failed'); }
      finally { this.loading = false; cx.notify(); }
    });
  }

  adopt(value) {
    // Keep persisted u64 values intact; the slider range only constrains new interaction.
    this.value = count(value);
    setSlider(this.field,Number(BigInt(this.value) > 50n ? 50n : BigInt(this.value)));
  }

  input(event,cx) {
    if (this.locked() || !Number.isInteger(event.value) || event.value < 1 || event.value > 50) return;
    this.value = String(event.value); this.dirty = true;
    if (event.kind === 'release') this.save(cx);
    cx.notify();
  }

  fail(key) { toast({id:'delegation-capacity',message:this.text[key],kind:'error'}); }

  save(cx) {
    if (this.pending || !this.connected || !this.saved) return;
    if (!this.request) {
      let value;
      try {
        value = count(this.value ?? '');
      } catch (_) { this.fail('capacity_invalid'); return; }
      if (value === this.saved.values.child_concurrency) { this.dirty = false; return; }
      try {
        this.serial += 1;
        this.request = prepareSettings({...this.saved.values,child_concurrency:value},{},
          String(this.saved.package.settings_revision));
      } catch (error) {
        // No request exists yet: preparation failures have no uncertain side effects.
        this.fail(faultCode(error.message ?? String(error)) === 'revision_conflict' ? 'role_conflict' : 'role_failed');
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
          this.adopt(this.saved.values.child_concurrency);
          forgetRequest(request); this.request = null;
          toast({id:'delegation-capacity',message:this.text.settings_saved,kind:'success'});
        } else {
          const code = result.Err?.code;
          this.fail(code === 'revision_conflict' ? 'role_conflict'
            : !code || ['outcome_unknown','unavailable','cancelled'].includes(code) ? 'role_unknown' : 'role_failed');
          if (code && !['outcome_unknown','unavailable','cancelled'].includes(code)) {
            forgetRequest(request); this.request = null;
            this.load(cx);
          }
        }
      } catch (error) {
        this.fail(faultCode(error.message ?? String(error)) === 'revision_conflict' ? 'role_conflict' : 'role_unknown');
      } finally { this.pending = false; if (!this.request) this.settled(cx); cx.notify(); }
    });
  }
}
