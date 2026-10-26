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
    this.value = null; this.queued = null; this.submitted = null; this.unknown = false;
    this.serial = 0; this.pending = false; this.loading = false; this.dirty = false; this.connected = true;
    this.visible = true;
    this.field = createSlider(8,{min:1,max:50,step:1,label:text.child_concurrency});
  }

  locked() { return !this.connected || !this.saved || !!this.request && this.unknown; }

  load(cx, explicit = false) {
    if (this.loading || this.request || !this.visible || !this.connected) return;
    this.loading = true;
    const serial = this.serial;
    cx.spawn(async cx => {
      try {
        const value = await readSettings();
        if (!this.request && serial === this.serial) {
          this.saved = value;
          if (!this.dirty) this.adopt(value.values.child_concurrency);
        }
      } catch (_) { if (this.visible && (explicit || !this.saved)) this.fail('role_failed'); }
      finally { this.loading = false; this.settled(cx); cx.notify(); }
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
    if (event.kind === 'release') { this.queued = this.value; this.save(cx); }
    cx.notify();
  }

  fail(key) { toast({id:'delegation-capacity',message:this.text[key],kind:'error'}); }

  save(cx) {
    if (this.pending || !this.connected || !this.saved) return;
    if (!this.request) {
      let value;
      try {
        value = count(this.queued ?? this.value ?? '');
      } catch (_) { this.fail('capacity_invalid'); return; }
      if (value === this.saved.values.child_concurrency) {
        this.queued = null; this.dirty = this.value !== value; return;
      }
      try {
        this.serial += 1;
        this.request = prepareSettings({...this.saved.values,child_concurrency:value},{},
          String(this.saved.package.settings_revision));
        this.submitted = value; this.queued = null; this.unknown = false;
      } catch (error) {
        // No request exists yet: preparation failures have no uncertain side effects.
        this.queued = null;
        this.fail(faultCode(error.message ?? String(error)) === 'revision_conflict' ? 'role_conflict' : 'role_failed');
        return;
      }
    }
    const request = this.request;
    this.pending = true; cx.notify();
    cx.spawn(async cx => {
      let saved = false;
      try {
        const result = await completeRequest(request);
        if (result.Ok?.kind === 'plugin_settings') {
          this.saved = result.Ok.data;
          // A receipt confirms its submitted value, not a later local slider draft.
          if (this.value === this.submitted) this.adopt(this.saved.values.child_concurrency);
          this.dirty = this.value !== this.saved.values.child_concurrency;
          forgetRequest(request); this.request = null; this.unknown = false; saved = true;
        } else {
          const code = result.Err?.code;
          this.unknown = !code || ['outcome_unknown','unavailable','cancelled'].includes(code);
          this.fail(code === 'revision_conflict' ? 'role_conflict' : this.unknown ? 'role_unknown' : 'role_failed');
          if (!this.unknown) {
            forgetRequest(request); this.request = null; this.queued = null;
            this.load(cx);
          }
        }
      } catch (error) {
        this.unknown = true;
        this.fail(faultCode(error.message ?? String(error)) === 'revision_conflict' ? 'role_conflict' : 'role_unknown');
      } finally {
        this.pending = false;
        if (saved && this.queued !== null && this.queued !== this.saved.values.child_concurrency) {
          this.save(cx);
        }
        if (!this.request) {
          if (saved) {
            this.queued = null;
            if (!this.dirty) toast({id:'delegation-capacity',message:this.text.settings_saved,kind:'success'});
          }
          this.settled(cx);
        }
        cx.notify();
      }
    });
  }
}
