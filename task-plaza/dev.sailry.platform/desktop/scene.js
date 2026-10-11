import {div,PathBuilder,Background} from 'gpui-kit';
import {Button,Icon,Tag} from 'gpui-component';
import {theme} from 'sailry';
import {ComposedButton} from 'sailry/ui';
import {sprite} from './art.js';
import {ROOMS,WORLD_WIDTH,WORLD_HEIGHT,PERSON_SIZE,DESK_WIDTH,DESK_HEIGHT,SEATED,STANDING,ATRIUM,seatPosition,approvalPosition} from './geometry.js';
export const variants = {waiting:'warning',running:'primary',completed:'success',failed:'danger',idle:'secondary'};

function board(view,value,index,scale) {
  const {board:bounds} = ROOMS[index], {text} = view, colors = theme().colors;
  const running = value?.items.filter(item => item.lane === 'running').length ?? 0;
  const waiting = value?.items.filter(item => item.approval).length ?? 0;
  const label = div().v_flex().size_full().min_w_0().justify_center().items_center().text_center().gap_1()
    .text_color(colors.foreground).text_sm().line_height(1.15)
    .child(div().font_semibold().truncate().child(value?.name ?? text.empty_room))
    .children(value ? [div().text_color(colors.muted_foreground).truncate().child(text.room_summary(running,waiting))] : []);
  const whiteboard = new Button(`plaza-room-${value?.key ?? index}`).outline().p_0().absolute()
    .left(bounds.x * scale).top(bounds.y * scale).w(bounds.width * scale).h(bounds.height * scale).min_h('2.5rem')
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
  view.targets.set(id,item);
  return div().id(`${id}-position`).absolute().left((position.x - dimension / 2) * scale)
    .top((position.y - dimension) * scale).w(size).h(size)
    .child(ComposedButton.new(id,{size,label:`${item.title}, ${item.status}, ${item.project}`,
      tooltip:`${item.title} · ${item.status}`})
      .child(div().relative().w(size).h(size).h_flex().justify_center()
        .children(selected ? [div().id('plaza-selection').absolute().bottom(0).left(size * 0.2).w(size * 0.6).h(12 * scale)
          .rounded_full().border_1().border_color(approval ? theme().colors.warning : theme().colors.primary)] : [])
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
