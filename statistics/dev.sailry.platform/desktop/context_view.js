import {div} from 'gpui-kit';
import {Button} from 'gpui-component';
import {theme} from 'sailry';
import {details} from './context.js';

export function render(view) {
  const colors=theme().colors;
  return div().id('context-details').v_flex().w(280).max_w_full().gap_2().text_sm()
    .children(details(view.state,view.text).map(row=>{
      const value=div().v_flex().min_w_0().gap_1()
        .child(div().child(row.value))
        .children(row.note ? [div().text_xs().text_color(colors.muted_foreground).child(row.note)] : []);
      return div().id(`context-${row.id}`).h_flex().items_start().justify_between().gap_3()
        .child(div().text_xs().flex_shrink_0().text_color(colors.muted_foreground).child(row.label))
        .child(row.target ? new Button('context-record').ghost().size('small').h_auto()
          .child(div().h_flex().w_full().justify_between().gap_2().child(value)
            .child(div().text_color(colors.muted_foreground).child(view.text.context_view_record)))
          .on_click(()=>view.reveal(row.target)) : value);
    }));
}
