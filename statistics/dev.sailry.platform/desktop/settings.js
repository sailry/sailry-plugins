import {View} from 'gpui-kit';
import {context,header_action} from 'sailry';
import {readUsageInventory,readUsageChoices,watchUsage,nextUsageChange,refreshUsage} from 'sailry/sdk';
import {nextTableEvent,nextControlEvent,writeClipboard,toast} from 'sailry/ui';
import {formatRows} from './requests.js';
import {messages} from './locales.js';
import {State,RANGES,choices} from './state.js';
import {render} from './view.js';

export default class Usage extends View {
  init(_props,cx) {
    const scope=JSON.parse(context());this.text=messages(scope.locale);this.state=new State(scope.node);
    this.inventory=null;this.resources=[];this.error=null;this.choiceCursor=null;
    this.observe(cx);
    cx.spawn(async ()=>{try {while(true) {
      const event=await nextTableEvent();
      if(event.table!=='usage-requests'||event.kind!=='copy'||event.revision!==`${this.state.generation}:${this.state.cursor}`)continue;
      const rows=formatRows(this.state.data()?.requests.items??[],this.text).rows;
      writeClipboard(event.rows.filter(index=>rows[index]).map(index=>rows[index].join('\t')).join('\n'));
    }} catch (_) { /* Releasing the table closes its event stream. */ }});
    cx.spawn(async cx=>{
      try {while(true) if(await header_action()==='usage-refresh')this.refresh(cx);}
      catch (_) { /* Closing the page releases its header. */ }
    });
    cx.spawn(async cx=>{
      try {while(true) this.control(await nextControlEvent(),cx);}
      catch (_) { /* Closing the page releases its controls. */ }
    });
  }
  /** Select confirmations carry the generation that rendered their choices; stale ones are ignored. */
  control(event,cx) {
    if(typeof event.value!=='string' || !event.id.startsWith('usage-filter-'))return;
    const [generation,...parts]=event.value.split(':');
    if(generation===String(this.state.generation))this.filter(event.id.slice('usage-filter-'.length),parts.join(':'),cx);
  }
  filter(field,value,cx) {if(this.state.select(field,value))this.observe(cx);}
  observe(cx) {
    const generation=this.state.start();this.error=null;this.choiceCursor=null;
    try {watchUsage(this.state.query,false);}catch(_){this.report('usage_read_failed');cx.notify();return;}
    cx.notify();
    cx.spawn(async cx=>{
      try {while(generation===this.state.generation) {
        const event=await nextUsageChange(this.state.cursor);
        if(!this.state.accept(event,generation))continue;
        if(this.state.advance()) {this.state.reset();this.state.view=null;this.observe(cx);return;}
        const error=this.state.view?.error?.code==='invalid_request' ? 'usage_query_failed' : this.state.view?.error ? 'usage_read_failed' : null;
        if(error)this.report(error);else this.error=null;
        const report=this.state.view?.report;
        if(report && this.choiceCursor!==report.cursor) {this.choiceCursor=report.cursor;this.loadChoices(generation,cx);}
        cx.notify();
      }} catch (_) { if(generation===this.state.generation){this.report('usage_read_failed');cx.notify();} }
    });
  }
  report(key) { if(this.error!==key)toast({id:'usage-error',message:this.text[key],kind:'error'});this.error=key; }
  loadChoices(generation,cx) {
    const query={...this.state.query,providers:[],models:[],before:null},cursor=this.choiceCursor;
    cx.spawn(async cx=>{
      try {
        const [inventory,report]=await Promise.all([readUsageInventory(this.state.node),readUsageChoices(query,this.state.node)]);
        if(generation!==this.state.generation || cursor!==this.choiceCursor)return;
        this.inventory=inventory;this.resources=report.resources;cx.notify();
      } catch (_) { /* Existing resource labels remain usable when a refresh fails. */ }
    });
  }
  refresh(cx) {
    const moved=this.state.advance();
    if(moved || this.state.page!==1 || this.error) {this.state.reset();this.state.view=null;this.observe(cx);}
    else refreshUsage();
  }
  page(value,cx) {if(this.state.turn(value))this.observe(cx);}
  group(value,cx) {if(this.state.group(value))this.observe(cx);else cx.notify();}
  header() {
    return {title:this.text.usage,actions:[{id:'usage-refresh',label:this.text.usage_refresh,icon:'icons/rotate-cw.svg',
      disabled:this.state.view?.refreshing ?? false}]};
  }
  /** Page filter choices; select item ids are tagged with the current query generation. */
  filters() {
    const state=this.state,text=this.text,options=choices(state,this.inventory,this.resources,text),tag=id=>`${state.generation}:${id}`;
    return {range:{items:Object.keys(RANGES).map(id=>({id,label:text[`usage_range_${id}`]})),selected:state.range},
      selects:['project','provider','model'].map(name=>({id:`usage-filter-${name}`,label:text[`usage_all_${name}s`],
        items:options[name].map(item=>({...item,id:tag(item.id)})),selected:tag(state.query[`${name}s`][0] ?? '')}))};
  }
  render() {return render(this);}
}
