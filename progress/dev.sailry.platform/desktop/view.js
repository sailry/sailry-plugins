import {div} from 'gpui-kit';
import {Button,Icon,Tag} from 'gpui-component';
import {Header,theme} from 'sailry';
import {pageInsets} from 'sailry/ui';
import {layout,WORLD_SIZE} from './floor.js';
import {scene,variants} from './scene.js';
import {dialog} from './dialogs.js';
export function render(view) {
  view.targets = new Map();
  const {text,board,floor} = view, colors = theme().colors;
  const model = layout(board.catalog,board.previews,text,floor), viewport = window.viewport_size();
  const fit = Math.max(0.55,Math.min(1,(viewport.width - pageInsets().rail_width - 48) / WORLD_SIZE,
    (viewport.height - 176) / WORLD_SIZE));
  const scale = fit * floor.zoom;
  const header = Header.new('activity-header',{content:JSON.stringify({
    items:[{label:text.activity_board_running,value:String(model.counts.running)},
      {label:text.activity_board_waiting,value:String(model.approvals.length)},
      {label:text.activity_idle,value:String(model.counts.idle)}],actions:[],
  })});
  const changeFloor = direction => (_event,cx) => {
    floor.page = Math.max(0,Math.min(model.pages - 1,floor.page + direction));cx.notify();
  };
  return div().id('activity-board').v_flex().size_full().min_w_0().min_h_0().text_color(colors.foreground)
    .child(header)
    .child(div().id('activity-toolbar').h_flex().flex_none().w_full().items_center().gap_2().px_4().py_2()
      .child(div().flex_1().min_w_0().text_sm().text_color(colors.muted_foreground).child(text.floor(floor.page + 1,model.pages)))
      .child(new Button('activity-floor-prev').ghost().size('small').disabled(floor.page === 0)
        .tooltip(text.previous).child(new Icon('icons/chevron-left.svg').size('small')).on_click(changeFloor(-1)))
      .child(new Button('activity-floor-next').ghost().size('small').disabled(floor.page + 1 === model.pages)
        .tooltip(text.next).child(new Icon('icons/chevron-right.svg').size('small')).on_click(changeFloor(1)))
      .child(new Button('activity-zoom-out').ghost().size('small').disabled(floor.zoom <= 0.75).label('−')
        .tooltip(text.zoom_out).on_click((_event,cx) => {floor.zoom = Math.max(0.75,floor.zoom - 0.25);cx.notify();}))
      .child(new Button('activity-zoom-reset').ghost().size('small').label(`${Math.round(floor.zoom * 100)}%`)
        .tooltip(text.zoom_reset).on_click((_event,cx) => {floor.zoom = 1;cx.notify();}))
      .child(new Button('activity-zoom-in').ghost().size('small').disabled(floor.zoom >= 1.5).label('+')
        .tooltip(text.zoom_in).on_click((_event,cx) => {floor.zoom = Math.min(1.5,floor.zoom + 0.25);cx.notify();})))
    .child(div().id('activity-viewport').relative().flex_1().min_w_0().min_h_0().overflow_x_scrollbar().overflow_y_scrollbar()
      .child(div().w_full().min_w(WORLD_SIZE * scale + 32).min_h('100%').v_flex().items_center().p_4()
        .child(scene(view,model,scale).my_auto())))
    .child(div().id('activity-legend').h_flex().flex_none().gap_3().px_4().py_2().border_t_1().border_color(colors.border)
      .children([['running',text.activity_board_running],['idle',text.activity_idle],['waiting',text.activity_board_waiting],
        ['waiting',text.activity_input],['completed',text.activity_completed],['failed',text.activity_failed]].map(([lane,label]) =>
        new Tag().variant(variants[lane]).size('small').child(label)))
      .children(board.connected ? [] : [div().flex_1().text_right().text_xs().text_color(colors.muted_foreground).child(text.live_disconnected)]))
    .child(dialog(view,model));
}
