import {div} from 'gpui-kit';
import {Button,Tag} from 'gpui-component';
import {Conversation,theme} from 'sailry';
import {Modal,openActivityTarget} from 'sailry/ui';
import {variants} from './scene.js';
import {plain} from './state.js';
function list(view,items) {
  const colors = theme().colors;
  return div().id('activity-detail-list').v_flex().flex_1().w_full().min_w_0().min_h_0().gap_2().overflow_y_scrollbar()
    .children(items.map(item => new Button(`activity-detail-${item.kind}-${item.id}`).ghost().p_2().w_full().flex_shrink(0)
      .tooltip(item.title).on_click((_event,cx) => view.inspect(item,cx))
      .child(div().h_flex().w_full().min_w_0().items_center().gap_2()
        .child(div().v_flex().flex_1().min_w_0().text_left().gap_1()
          .child(div().font_medium().truncate().child(item.title))
          .child(div().text_xs().text_color(colors.muted_foreground).truncate().child(item.project))
          .children(item.preview ? [div().text_xs().text_color(colors.muted_foreground).truncate().child(plain(item.preview))] : []))
        .child(new Tag().variant(variants[item.lane] ?? 'secondary').size('small').child(item.status)))));
}
export function dialog(view,model) {
  const {text,selected} = view, session = selected?.kind === 'session';
  const room = selected?.kind === 'room' ? model.rooms.find(room => room.key === selected.id) : null;
  const title = session ? selected.title : room?.name ?? text.approval_plaza;
  const props = {active:view.dialogOpen && session};
  if (session) props.session = selected.id;
  const chat = Conversation.new('activity-detail-chat',props);
  const body = div().id('activity-detail-body').v_flex().w_full().min_w_0().min_h_0()
    .h(Math.max(240,Math.min(620,window.viewport_size().height * 0.6)))
    .child(session ? chat : list(view,room?.items ?? model.approvals));
  if (!session) body.child(chat);
  // The inactive native component releases its subscription on dismissal.
  return Modal.new('activity-dialog',{open:view.dialogOpen,form:true,title,width:session ? 960 : 560})
    .child(body)
    .children(session ? [div().h_flex().w_full().justify_end()
      .child(new Button('activity-open-conversation').outline().size('small').label(text.open_conversation)
        .on_click((_event,cx) => {openActivityTarget('session',view.selected.id);view.closeDetails(cx);} ))] : []);
}
