import {div} from 'gpui-kit';
import {Button,Tag} from 'gpui-component';
import {Conversation,theme} from 'sailry';
import {PanelHeader,IconButton} from 'sailry/ui';
import {variants} from './scene.js';
import {plain} from './state.js';
export const DETAIL_WIDTH = 360;

function list(view,items) {
  const colors = theme().colors;
  return div().id('plaza-detail-list').v_flex().flex_1().w_full().min_w_0().min_h_0().p_3().gap_2().overflow_y_scrollbar()
    .children(items.map(item => new Button(`plaza-detail-${item.kind}-${item.id}`).ghost().p_2().w_full().flex_shrink(0)
      .tooltip(item.title).on_click((_event,cx) => view.inspect(item,cx))
      .child(div().h_flex().w_full().min_w_0().items_center().gap_2()
        .child(div().v_flex().flex_1().min_w_0().text_left().gap_1()
          .child(div().font_medium().truncate().child(item.title))
          .child(div().text_xs().text_color(colors.muted_foreground).truncate().child(item.project))
          .children(item.preview ? [div().text_xs().text_color(colors.muted_foreground).truncate().child(plain(item.preview))] : []))
        .child(new Tag().variant(variants[item.lane] ?? 'secondary').size('small').child(item.status)))));
}
export function details(view,model) {
  const {text,selected} = view, session = view.panelOpen && selected?.kind === 'session';
  const current = session ? selected.id : null;
  // A different native instance preserves the SDK's captured-session contract.
  // Release the prior instance in the same render before mounting the selection.
  const released = view.chatSession && view.chatSession !== current
    ? Conversation.new(`plaza-detail-chat-${view.chatSession}`,{active:false}) : null;
  view.chatSession = current;
  if (!view.panelOpen) return {panel:null,released};
  const room = selected?.kind === 'room' ? model.rooms.find(room => room.key === selected.id) : null;
  const title = session ? selected.title : room?.name ?? text.approval_plaza;
  const header = PanelHeader.new('plaza-detail-header',{draggable:false,bordered:true})
    .child(div().h_flex().w_full().min_w_0().items_center().gap_2()
      .child(div().flex_1().min_w_0().truncate().text_sm().font_medium().child(title))
      .children(session ? [IconButton.new('plaza-open-conversation',{icon:'external-link',label:text.open_conversation})] : [])
      .child(IconButton.new('plaza-detail-close',{icon:'close',label:text.close})));
  return {released,panel:div().id('plaza-detail-panel').v_flex().size_full().min_w_0().min_h_0()
    .border_l_1().border_color(theme().colors.border).child(header)
    .child(session ? Conversation.new(`plaza-detail-chat-${selected.id}`,{session:selected.id,active:true})
      : list(view,room?.items ?? model.approvals))};
}
