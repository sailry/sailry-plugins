import {View} from 'gpui-kit';
import {context,header_action} from 'sailry';
import * as artifacts from 'sailry/artifacts';
import {nextControlEvent,nextPickerEvent,toast} from 'sailry/ui';
import {Controller} from './controller.js';
import {messages} from './locales.js';
import {render} from './view.js';

export default class Brief extends View {
  init(_props,cx) {
    this.text = messages(JSON.parse(context()).locale);
    this.exportOpen = false;
    this.state = new Controller(artifacts,artifacts.artifactResource(),() => {},key => this.report(key));
    cx.spawn(async cx => {this.state.changed = () => cx.notify();await this.state.refresh();});
    cx.spawn(async cx => {
      let cursor;
      try {while (true) {
        const state = await artifacts.nextArtifactChange(cursor ?? ''),first = cursor === undefined;cursor = state.cursor;
        this.state.connected = state.connected;
        if (!first && state.connected) await this.state.refresh();
        cx.notify();
      }} catch (_) { /* The captured panel stops observing when released. */ }
    });
    cx.spawn(async () => {
      try {while (true) {
        const event = await nextControlEvent();
        if (event.id === 'brief-version') await this.state.select(event.value);
        else if (event.id === 'brief-retry') await this.state.refresh();
        else if (event.id === 'brief-more-versions') await this.state.more();
      }} catch (_) { /* Native Kit controls retain their captured resource. */ }
    });
    cx.spawn(async () => {
      try {while (true) {
        const raw = await header_action();
        let event;try {event = JSON.parse(raw);} catch (_) {event = {id:raw};}
        if (event.id === 'brief-version') await this.state.select(event.value);
        else if (event.id === 'brief-more-versions') await this.state.more();
        else if (event.id === 'brief-export' && !this.state.loading && !this.state.exporting && this.state.artifact) {this.exportOpen = true;cx.notify();}
      }} catch (_) { /* Header actions retain the captured document. */ }
    });
    cx.spawn(async () => {
      try {while (true) {
        const event = await nextPickerEvent();
        if (event.picker !== 'brief-export-picker') continue;
        this.exportOpen = false;cx.notify();
        if (event.kind === 'select') await this.state.export(event.value?.format);
      }} catch (_) { /* Closing a menu does not replay an export. */ }
    });
    cx.spawn(async () => {
      try {while (true) {
        const event = await artifacts.nextArtifactEvent();
        if (event.kind === 'edited' && event.artifact === this.state.resource?.id) await this.state.freeze(event.revision);
      }} catch (_) { /* A draft pins only its captured document revision. */ }
    });
  }
  report(key) {toast({id:'brief-operation',kind:'error',message:this.text[key]});}
  release() {this.state.stop();}
  render() {return render(this);}
}
