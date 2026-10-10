// Package-owned settings; every operation uses the captured Node's shared services.
import {View} from 'gpui-kit';
import {context} from 'sailry';
import {prepareRequest,completeRequest,forgetRequest,nextChange,nextCodeInstallations,faultCode} from 'sailry/sdk';
import {createText,readText,releaseText,nextTextEvent} from 'sailry/forms';
import {nextControlEvent,modal_closed,toast} from 'sailry/ui';
import {messages} from './locales.js';
import {rows,override,failure} from './model.js';
import {render} from './view.js';

const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

async function read(kind) {
  const request = prepareRequest({kind});
  try {
    const result = await completeRequest(request);
    if (result.Err) {
      const error = new Error(result.Err.message);
      error.fault = result.Err; error.kind = kind; throw error;
    }
    return result.Ok.data;
  } finally { forgetRequest(request); }
}

export default class Settings extends View {
  init(_props,cx) {
    this.text = messages(JSON.parse(context()).locale);
    this.saved = null; this.catalog = []; this.installations = []; this.rules = null;
    this.ready = false; this.connected = true; this.loading = false; this.pending = false;
    this.refresh = false; this.request = null; this.dialog = null; this.serial = 0; this.tab = 'available';
    this.load(cx);
    cx.spawn(async cx => {
      let cursor;
      try { while (true) {
        const update = await nextChange(cursor), first = cursor === undefined;
        cursor = update.cursor; this.connected = update.connected;
        if (update.connected && !first) this.load(cx);
        cx.notify();
      } } catch (_) { /* View disposal closes the captured scope. */ }
    });
    cx.spawn(async cx => {
      while (true) {
        try {
          const installations = await nextCodeInstallations();
          for (const item of installations) {
            const previous = this.installations.find(value => value.package === item.package);
            if (previous && previous.status !== item.status && this.request?.command?.data?.install?.package !== item.package) {
              const key = {ready:'code_installed',failed:'code_failed',cancelled:'code_cancelled'}[item.status];
              if (key) toast({id:'code-operation',kind:item.status === 'failed' ? 'error' : 'info',message:this.text[key]});
            }
          }
          const changed = JSON.stringify(installations.map(item => [item.package,item.receipt]))
            !== JSON.stringify(this.installations.map(item => [item.package,item.receipt]));
          this.installations = installations;
          if (changed) this.load(cx);
          cx.notify();
        } catch (_) { await cx.sleep(1000); }
      }
    });
    cx.spawn(async cx => { try { while (true) this.control(await nextControlEvent(),cx); } catch (_) {} });
    cx.spawn(async cx => { try { while (true) {
      const event = await modal_closed();
      if (event === this.dialog?.id) this.close(cx);
    } } catch (_) {} });
    cx.spawn(async cx => { try { while (true) {
      const event = await nextTextEvent(), editor = this.dialog;
      if (event.kind !== 'change' || editor?.kind !== 'edit' || !editor.fields.includes(event.id)) continue;
      const revision = ++editor.changed;
      cx.spawn(async cx => {
        await cx.sleep(350);
        if (this.dialog === editor && editor.changed === revision) this.flush(false,cx);
      });
    } } catch (_) {} });
  }
  busy() { return !this.ready || !this.connected || this.loading || this.pending || !!this.request; }
  rows() { return rows(this.catalog,this.installations); }
  fail(code,message,kind) {
    toast({id:'code-operation',kind:'error',message:this.text[failure(code,message,kind)]});
  }
  load(cx) {
    if (!this.connected) return;
    if (this.loading || this.pending || this.request) { this.refresh = true; return; }
    this.loading = true;
    cx.notify();
    cx.spawn(async cx => {
      try {
        const settings = await read('read_code_settings');
        const catalog = await read('read_code_catalog');
        const installations = await read('list_code_installations');
        const rules = await read('read_code_rules');
        this.saved = settings; this.catalog = catalog; this.installations = installations; this.rules = rules;
        this.ready = true;
      } catch (error) {
        this.fail(error.fault?.code ?? faultCode(String(error.message)),error.fault?.message,error.kind);
      }
      finally {
        this.loading = false; const refresh = this.refresh; this.refresh = false;
        if (refresh) this.load(cx);
        else if (this.dialog?.kind === 'edit' && !this.dialog.blocked) this.flush(false,cx);
        cx.notify();
      }
    });
  }
  submit(command,cx) {
    if (this.busy()) return;
    this.request = {id:prepareRequest(command),command}; this.retry(cx);
  }
  retry(cx) {
    if (!this.request || this.pending || !this.connected) return;
    const request = this.request; this.pending = true; cx.notify();
    cx.spawn(async cx => {
      try {
        const result = await completeRequest(request.id);
        if (result.Err) {
          this.fail(result.Err.code,result.Err.message,request.command.kind);
          if (result.Err.code === 'outcome_unknown') return;
          if (request.editor) { request.editor.blocked = true; request.editor.closing = false; }
        } else {
          if (result.Ok.kind === 'code_settings') {
            this.saved = result.Ok.data;
            if (request.editor && this.dialog === request.editor) {
              request.editor.previous = clone(this.saved.servers[request.editor.row.server]);
              request.editor.revision = this.saved.revision;
            }
          }
          if (result.Ok.kind === 'code_installation' && result.Ok.data.receipt) this.tab = 'installed';
          toast({id:'code-operation',kind:'info',message:this.text[request.command.kind === 'uninstall_code_server'
            ? 'code_uninstalled' : request.command.kind === 'install_code_server' ? 'code_installed' : 'code_saved']});
        }
        forgetRequest(request.id); this.request = null;
      } catch (_) { this.fail('outcome_unknown'); }
      finally {
        this.pending = false;
        if (!this.request) {
          if (this.dialog?.kind === 'edit' && !this.dialog.blocked) {
            if (this.dialog.closing) this.close(cx); else this.flush(false,cx);
          }
          this.load(cx);
        }
        cx.notify();
      }
    });
  }
  toggle(server,enabled,cx) {
    if (this.busy()) return;
    const settings = clone(this.saved);
    settings.servers[server] = {...(settings.servers[server] ?? override(['','','',''],null)),disabled:!enabled};
    this.submit({kind:'save_code_settings',data:{settings,expected_revision:this.saved.revision}},cx);
  }
  open(kind,row,cx) {
    if (this.dialog || this.busy()) return;
    this.dialog = {id:`code-dialog-${++this.serial}`,kind,row};
    if (kind === 'edit') {
      const previous = this.saved.servers[row.server];
      Object.assign(this.dialog,{previous:clone(previous),revision:this.saved.revision,changed:0,
        fields:[previous?.command ?? '',...['args','config','environment'].map(key => previous?.[key] == null
          ? '' : JSON.stringify(previous[key]))].map(value => createText(value))});
    }
    cx.notify();
  }
  flush(report,cx) {
    const editor = this.dialog;
    if (editor?.kind !== 'edit') return true;
    let value;
    try { value = override(editor.fields.map(readText),editor.previous); }
    catch (_) { if (report) this.fail('invalid_request'); return false; }
    if (JSON.stringify(value) === JSON.stringify(editor.previous)
        || (!editor.previous && editor.fields.every(field => !readText(field).trim()))) return true;
    if (this.busy() || this.loading || editor.blocked) return false;
    if (this.saved.revision !== editor.revision) {
      editor.blocked = true;
      this.fail('revision_conflict'); return false;
    }
    const settings = clone(this.saved); settings.servers[editor.row.server] = value;
    this.request = {id:prepareRequest({kind:'save_code_settings',data:{settings,expected_revision:editor.revision}}),
      command:{kind:'save_code_settings'},editor};
    this.retry(cx);
    return false;
  }
  clean() {
    const editor = this.dialog;
    if (editor?.kind !== 'edit') return true;
    try { return JSON.stringify(override(editor.fields.map(readText),editor.previous)) === JSON.stringify(editor.previous)
      || (!editor.previous && editor.fields.every(field => !readText(field).trim())); }
    catch (_) { return false; }
  }
  close(cx) {
    if (this.dialog?.kind === 'edit') {
      this.dialog.closing = true;
      if (!this.flush(true,cx)) return;
    }
    this.dialog?.fields?.forEach(releaseText); this.dialog = null; cx.notify();
  }
  reloadEditor(cx) {
    const editor = this.dialog;
    if (editor?.kind !== 'edit' || this.busy() || this.loading) return;
    editor.previous = clone(this.saved.servers[editor.row.server]);
    editor.revision = this.saved.revision; editor.blocked = false; editor.closing = false;
    cx.notify();
  }
  confirm(kind,row,cx) {
    this.close(cx); this.open(kind,row,cx);
  }
  cancel(packageName,cx) {
    cx.spawn(async cx => {
      let request;
      try {
        request = prepareRequest({kind:'cancel_code_install',data:{package:packageName}});
        const result = await completeRequest(request);
        if (result.Err) this.fail(result.Err.code,result.Err.message,'cancel_code_install');
        else toast({id:'code-operation',message:this.text.code_cancel_requested,kind:'info'});
      } catch (_) { this.fail('failed'); }
      finally { if (request) forgetRequest(request); cx.notify(); }
    });
  }
  control(event,cx) {
    if (event.id === 'code-tabs') { this.tab = event.value; cx.notify(); return; }
    for (const row of this.rows()) {
      if (event.id === `code-details-${row.server}`) this.open('details',row,cx);
      if (event.id === `code-edit-${row.server}`) this.open('edit',row,cx);
      if (event.id === `code-install-${row.server}` && row.candidate?.package?.install) this.open('install',row,cx);
      if (event.id === `code-cancel-${row.server}`) this.cancel(row.installation.package,cx);
    }
  }
  render() { return render(this); }
}
