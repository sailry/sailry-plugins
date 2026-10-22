import {View} from 'gpui-kit';
import {context} from 'sailry';
import {publishContributions} from 'sailry/sdk';
import {readComposer,nextComposerChange,revealComposerEntry,toast} from 'sailry/ui';
import {messages} from './locales.js';
import {metrics} from './metrics.js';
import {render} from './context_view.js';

export default class Composer extends View {
  init(_props,cx) {
    this.text=messages(JSON.parse(context()).locale);
    this.state=readComposer();
    this.publish();
    cx.spawn(async cx=>{
      try {while(true) {
        this.state=await nextComposerChange(this.state.cursor);
        this.publish(); cx.notify();
      }} catch (_) { /* The captured composer owns the observation lifetime. */ }
    });
  }
  publish() { publishContributions(metrics(this.state,this.text)); }
  reveal(target) {
    try {revealComposerEntry(target);}
    catch (_) {toast({id:'context-reveal',kind:'error',message:this.text.context_reveal_failed});}
  }
  render() {return render(this);}
}
