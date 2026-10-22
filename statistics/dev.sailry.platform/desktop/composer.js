import {View} from 'gpui-kit';
import {context} from 'sailry';
import {publishContributions,nextContributionEvent} from 'sailry/sdk';
import {readComposer,nextComposerChange,revealComposerEntry,toast} from 'sailry/ui';
import {messages} from './locales.js';
import {metrics} from './metrics.js';
import {render} from './context_view.js';

export default class Composer extends View {
  init(_props,cx) {
    this.text=messages(JSON.parse(context()).locale);
    this.state=readComposer(); this.open=false;
    this.publish();
    cx.spawn(async cx=>{
      try {while(true) {
        this.state=await nextComposerChange(this.state.cursor);
        this.publish(); cx.notify();
      }} catch (_) { /* The captured composer owns the observation lifetime. */ }
    });
    cx.spawn(async cx=>{
      try {while(true) {
        const event=await nextContributionEvent();
        if(event.id!=='context')continue;
        if(event.kind==='change' && typeof event.value==='boolean')this.open=event.value;
        this.publish(event); cx.notify();
      }} catch (_) { /* Releasing the contribution closes its event stream. */ }
    });
  }
  publish(event) { publishContributions(metrics(this.state,this.text,this.open,event)); }
  reveal(target,cx) {
    try {revealComposerEntry(target);this.open=false;this.publish();cx.notify();}
    catch (_) {toast({id:'context-reveal',kind:'error',message:this.text.context_reveal_failed});}
  }
  render() {return render(this);}
}
