import {div} from 'gpui-kit';
import {Button} from 'gpui-component';
import {theme} from 'sailry';
import {details} from './context.js';

export function render(view) {
  const colors=theme().colors;
  return div().id('context-details').v_flex().w(296).max_w_full().gap_3().text_sm()
    .child(div().font_semibold().child(view.text.context_title))
    .children(details(view.state,view.text).map(row=>{
      const value=div().v_flex().min_w_0().gap_1()
        .child(div().child(row.value))
        .children(row.note ? [div().text_xs().text_color(colors.muted_foreground).child(row.note)] : []);
      return div().id(`context-${row.id}`).v_flex().gap_1()
        .child(div().text_xs().text_color(colors.muted_foreground).child(row.label))
        .child(row.target ? new Button('context-record').ghost().size('small').h_auto().w_full()
          .child(div().h_flex().w_full().justify_between().gap_2().child(value)
            .child(div().text_color(colors.muted_foreground).child(view.text.context_view_record)))
          .on_click((_,cx)=>view.reveal(row.target,cx)) : value);
    }));
}
