import {div,PathBuilder,Background} from 'gpui-kit';
import {Button,Icon,Tag} from 'gpui-component';
import {theme} from 'sailry';
import {ComposedButton} from 'sailry/ui';
import {sprite} from './art.js';
import {statusColors,statusColor} from './state.js';
import {ROOMS,WORLD_WIDTH,WORLD_HEIGHT,PERSON_SIZE,DESK_WIDTH,DESK_HEIGHT,SEATED,STANDING,ATRIUM,seatPosition,approvalPosition} from './geometry.js';
export const variants = {waiting:'warning',running:'primary',completed:'success',failed:'danger',idle:'secondary'};

function board(view,value,index,scale) {
  const {board:bounds} = ROOMS[index], {text} = view, colors = theme().colors;
  const counts = {running:0,approval:0,completed:0,idle:0};
  for (const item of value?.items ?? []) {
    if (item.approval) counts.approval += 1;
    else if (item.lane in counts) counts[item.lane] += 1;
  }
  const id = `plaza-room-${value?.key ?? index}`, width = Math.max(bounds.width * scale,220);
  // A definite height lets the native button's content fill the final size,
  // including room for its border and the three theme-sized text rows.
  const height = Math.max(bounds.height * scale,window.rem_size() * 4.25);
  const entries = [['running',text.room_running],['approval',text.room_approvals],['completed',text.room_completed],['idle',text.room_idle]];
  const label = div().v_flex().size_full().min_w_0().justify_center().items_center().text_center().gap_0p5().px_3().py_1()
    .text_color(colors.foreground).text_sm().line_height(1.15)
    .child(div().w_full().font_semibold().truncate().child(value?.name ?? text.empty_room))
    .children(value ? [div().id(`${id}-statistics`).v_flex().w_full().gap_0p5()
      .children([0,2].map(offset => div().id(`${id}-row-${offset / 2}`).h_flex().w_full().gap_3()
        .children(entries.slice(offset,offset + 2).map(([state,title]) => div().id(`${id}-${state}`).h_flex().flex_1().min_w_0().items_center().justify_between().gap_2()
          .child(div().truncate().text_color(colors.muted_foreground).child(title))
          .child(div().flex_none().font_medium().text_color(colors[statusColors[state]]).child(String(counts[state])))))))] : []);
  const whiteboard = new Button(id).outline().p_0().absolute()
    .left((bounds.x + bounds.width / 2) * scale - width / 2).top(bounds.y * scale).w(width).h(height)
    .bg(colors.background).disabled(!value).tooltip(value?.name ?? text.empty_room).child(label);
  if (value) whiteboard.on_click((_event,cx) => view.inspectRoom(value.key,cx));
  return whiteboard;
}
function outline(index,scale) {
  const {bounds} = ROOMS[index], width = bounds.width * scale, height = bounds.height * scale;
  const door = 46 * scale, middle = width / 2, path = PathBuilder.stroke(1);
  // The open threshold makes a room boundary, with no opaque card or wall layer.
  path.move_to(middle - door / 2,height - 4).line_to(middle - door / 2,height)
    .line_to(4,height).curve_to(0,height - 4,0,height).line_to(0,4).curve_to(4,0,0,0)
    .line_to(width - 4,0).curve_to(width,4,width,0).line_to(width,height - 4)
    .curve_to(width - 4,height,width,height).line_to(middle + door / 2,height)
    .line_to(middle + door / 2,height - 4);
  return div().id(`plaza-room-outline-${index}`).absolute()
    .left(bounds.x * scale).top(bounds.y * scale).w(width).h(height)
    .child(window.paint_path(path.build(),Background.solid(theme().colors.muted_foreground).opacity(0.55)).w(width).h(height));
}
function paging(view,value,index,scale) {
  if (!value || value.pages < 2) return null;
  const {bounds} = ROOMS[index], colors = theme().colors;
  return div().id(`plaza-room-pages-${value.key}`).absolute()
    .left((bounds.x + bounds.width / 2 - 37) * scale).top((bounds.y + bounds.height + 4) * scale)
    .h_flex().items_center().gap_1().text_xs().text_color(colors.muted_foreground)
    .child(new Button(`plaza-room-prev-${value.key}`).ghost().size('small').p_0().w(22).h(20)
      .disabled(value.page === 0).tooltip(view.text.previous).child(new Icon('icons/chevron-left.svg').size('xsmall'))
      .on_click((_event,cx) => {view.floor.turnRoom(value.key,-1,value.pages);cx.notify();}))
    .child(`${value.page + 1}/${value.pages}`)
    .child(new Button(`plaza-room-next-${value.key}`).ghost().size('small').p_0().w(22).h(20)
      .disabled(value.page + 1 === value.pages).tooltip(view.text.next).child(new Icon('icons/chevron-right.svg').size('xsmall'))
      .on_click((_event,cx) => {view.floor.turnRoom(value.key,1,value.pages);cx.notify();}));
}
function person(view,item,position,scale,approval = false) {
  const id = item.kind === 'terminal' ? `plaza-terminal-${item.id}` : `plaza-${item.id}`;
  const dimension = approval ? 80 : PERSON_SIZE, size = dimension * scale, index = approval ? STANDING[item.character] : SEATED[item.character];
  const status = approval ? null : item.waiting === 'input' ? '?' : item.lane === 'failed' ? '!'
    : item.lane === 'completed' ? '✓' : item.kind === 'terminal' ? '>_' : null;
  const selected = view.panelOpen && view.selected?.kind === 'session' && view.selected.id === item.id;
  const color = theme().colors[statusColor(item)];
  view.targets.set(id,item);
  return div().id(`${id}-position`).absolute().left((position.x - dimension / 2) * scale)
    .top((position.y - dimension) * scale).w(size).h(size)
    .child(ComposedButton.new(id,{size,label:`${item.title}, ${item.status}, ${item.project}`,
      tooltip:`${item.title} · ${item.status}`})
      .child(div().relative().w(size).h(size).h_flex().justify_center()
        .child(div().id(`${id}-status`).absolute().bottom(0).left(size * 0.07).w(size * 0.86).h(14 * scale)
          .rounded_full().border_2().border_color(color)
          .child(div().absolute().inset(0).rounded_full().bg(color).opacity(0.22)))
        .children(selected ? [div().id(`${id}-selection`).absolute().bottom(0).left(size * 0.03).w(size * 0.94).h(18 * scale)
          .rounded_full().border_1().border_color(theme().colors.foreground)] : [])
        .child(sprite(id,index,size))
        .children(status ? [div().absolute().top(14 * scale).right(0)
          .child(new Tag().variant(variants[item.lane] ?? 'secondary').size('small').rounded_full().child(status))] : [])));
}
function plaza(view,model,scale) {
  const colors = theme().colors, width = ATRIUM.width * scale, height = ATRIUM.height * scale;
  return div().id('plaza-atrium').absolute().left(ATRIUM.x * scale).top(ATRIUM.y * scale).w(width).h(height)
    .children([0,22].map(inset => div().absolute().inset(inset * scale).rounded_full().border_1().border_color(colors.border)))
    .child(div().absolute().bottom(6 * scale).w_full().text_center().text_sm().text_color(colors.muted_foreground)
      .child(model.approvals.length ? view.text.approval_count(model.approvals.length) : view.text.approval_plaza));
}
export function scene(view,model,scale) {
  const world = div().id('plaza-world').relative().flex_shrink(0).w(WORLD_WIDTH * scale).h(WORLD_HEIGHT * scale)
    .children(ROOMS.map((_room,index) => outline(index,scale))).child(plaza(view,model,scale));
  const furnishings = [], people = [];
  for (let room = 0;room < 8;room += 1) {
    const value = model.visible[room];
    for (let seat = 0;seat < 6;seat += 1) {
      const position = seatPosition(room,seat), item = value?.visible.find(item => item.seat % 6 === seat);
      const lit = item && !item.approval && item.phase === 'turn_tools_running';
      const identity = `${value?.key ?? room}-${seat}`;
      furnishings.push({depth:position.y,element:div().id(`plaza-desk-${identity}`).absolute()
        .left((position.x - DESK_WIDTH / 2) * scale).top((position.y - 14 - DESK_HEIGHT) * scale)
        .w(DESK_WIDTH * scale).h(DESK_HEIGHT * scale)
        .child(sprite(`plaza-monitor-${identity}`,lit ? 1 : 0,DESK_HEIGHT * scale,DESK_WIDTH * scale))});
      if (item && !item.approval) people.push({item,position});
      else furnishings.push({depth:position.y + 0.1,element:div().id(`plaza-chair-${identity}`).absolute()
        .left((position.x - 17) * scale).top((position.y - 36) * scale).w(34 * scale).h(36 * scale)
        .child(sprite(`plaza-empty-chair-${identity}`,2,36 * scale))});
    }
  }
  model.approvals.slice(0,6).forEach((item,index) => people.push({item,position:approvalPosition(index,model.approvals.length),approval:true}));
  return world.children([...furnishings,...people.map(value => ({depth:value.position.y + 0.1,
      element:person(view,value.item,value.position,scale,value.approval)}))]
      .sort((left,right) => left.depth - right.depth).map(value => value.element))
    .children(ROOMS.map((_room,index) => board(view,model.visible[index],index,scale)))
    .children(ROOMS.map((_room,index) => paging(view,model.visible[index],index,scale)).filter(Boolean));
}
