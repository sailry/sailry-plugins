import {View} from 'gpui-kit';
import {context} from 'sailry';
import {nextChange,prepareRequest,completeRequest,forgetRequest,faultCode,publishContributions,nextContributionEvent} from 'sailry/sdk';
import {readComposer,nextComposerChange,toast} from 'sailry/ui';
import {messages} from './locales.js';
import {render} from './view.js';

export default class Goals extends View {
  init(_props,cx) {
    this.scope=JSON.parse(context()); this.text=messages(this.scope.locale);
    this.state=readComposer(); this.goal=null; this.open=false;
    this.busy=false; this.loading=false; this.pending=null; this.readFailed=false; this.readError=null;
    this.publish(); this.refresh(cx);
    cx.spawn(async cx=>{
      try {while(true) {
        this.accept(await nextComposerChange(this.state.cursor)); this.publish(); cx.notify();
      }} catch (_) {}
    });
    cx.spawn(async cx=>{
      let cursor='';
      try {while(true) {const change=await nextChange(cursor);cursor=change.cursor;this.refresh(cx);}}
      catch (_) {}
    });
    cx.spawn(async cx=>{
      try {while(true) {
        const event=await nextContributionEvent();
        if (event.id==='status') {
          this.open=event.kind==='invoke' ? true : event.value===true; this.refresh(cx);
        }
        this.publish(event);cx.notify();
      }} catch (_) {}
    });
  }
  accept(state) {
    const left=state.cursor,right=this.state.cursor;
    if (left.length>right.length || left.length===right.length && left>=right) this.state=state;
  }
  enabled() {return this.state.connected && !this.state.busy && !this.state.readonly && !this.busy && !this.pending && this.state.mode!=='plan';}
  draft() {return this.state.command?.name==='goal' && this.state.command.package.name===this.scope.package.name ? this.state.command.arguments : null;}
  publish(event) {
    const label=this.goal ? this.text[this.goal.state] ?? this.text.goal : this.text.goal;
    const tone=this.goal?.state==='completed' ? 'success' : this.goal?.state==='failed' ? 'danger' : ['paused','blocked'].includes(this.goal?.state) ? 'warning' : 'muted';
    publishContributions([
      {id:'goal',enabled:this.enabled(),...(event?.id==='goal'?{reply_to:event.sequence}:{})},
      {id:'status',enabled:this.state.connected,visible:!!this.goal || this.open || this.draft()!==null,value:this.open,label:{label:this.text.goal},
        segments:[{label:{label:this.text.goal},tone:'muted'},...(this.goal ? [{label:{label},tone}] : [])],
        ...(event?.id==='status'?{reply_to:event.sequence}:{})},
    ]);
  }
  fail(key) {toast({id:'goal-error',kind:'error',message:this.text[key]});}
  refresh(cx) {
    if (!this.state.session || !this.state.connected) {this.goal=null;return;}
    if (this.loading) {this.dirty=true;return;}
    this.loading=true;
    this.publish();cx.notify();
    cx.spawn(async cx=>{
      try {do {
        this.dirty=false;
        const id=prepareRequest({kind:'call_plugin',data:{handler:'read',input:{}}});
        let result;
        try {result=await completeRequest(id);}
        finally {forgetRequest(id);}
        if (result.Err) {const error=new Error(result.Err.message);error.code=result.Err.code;throw error;}
        this.goal=result.Ok.data.goal;
        this.readFailed=false;
        this.readError=null;
      } while(this.dirty);}
      catch (error) {
        this.readError={code:error.code ?? faultCode(error.message ?? String(error)),message:error.message ?? String(error)};
        if (!this.readFailed) this.fail('readFailed');this.readFailed=true;
      }
      finally {this.loading=false;this.publish();cx.notify();}
    });
  }
  perform(kind,cx) {
    if (this.busy || this.loading || this.pending || !this.state.connected || this.state.readonly || !this.goal) return;
    this.pending={id:prepareRequest({kind:'call_plugin',data:{handler:'control',input:{kind,expected_revision:this.goal.revision}}}),kind};
    this.execute(cx);
  }
  execute(cx) {
    if (this.busy || !this.pending) return;
    this.busy=true;this.publish();cx.notify();
    cx.spawn(async cx=>{
      const pending=this.pending;
      try {
        const result=await completeRequest(pending.id);
        if (result.Err) {const error=new Error(result.Err.message);error.code=result.Err.code;throw error;}
        forgetRequest(pending.id);this.pending=null;
        if (pending.kind==='clear') this.open=false;
        toast({id:'goal-action',kind:'info',message:this.text[pending.kind==='clear'?'cleared':pending.kind==='pause'?'paused':'active']});
      } catch(error) {
        const code=error.code ?? faultCode(error.message ?? String(error));
        const uncertain=['outcome_unknown','unavailable','busy'].includes(code);
        this.fail(uncertain?'uncertain':'error');
        if (!uncertain) {forgetRequest(pending.id);this.pending=null;}
      } finally {this.busy=false;this.refresh(cx);this.publish();cx.notify();}
    });
  }
  render() {return render(this);}
}
