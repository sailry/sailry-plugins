import {div} from 'gpui-kit';
import {Button,Icon,Tag} from 'gpui-component';
import {theme} from 'sailry';
import {ComposedButton} from 'sailry/ui';
import {sprite} from './art.js';
import {ROOM_CELLS,TILE_SIZE,WORLD_SIZE,DESK_SIZE,PERSON_SIZE,seatPosition} from './floor.js';
export const variants = {waiting:'warning',running:'primary',completed:'success',failed:'danger',idle:'secondary'};

function board(view,room,scale) {
  const colors = theme().colors, {text} = view;
  const running = room.items.filter(item => item.lane === 'running').length;
  const waiting = room.items.filter(item => item.approval).length;
  return new Button(`activity-room-${room.key}`).ghost().p_0().absolute()
    .left(118 * scale).top(77 * scale).w(117 * scale).h(53 * scale)
    .tooltip(room.name).on_click((_event,cx) => view.inspectRoom(room.key,cx))
    .child(div().v_flex().size_full().min_w_0().justify_center().px_1().rounded_sm()
      .bg(colors.surface).text_color(colors.foreground).text_size(12 * scale).line_height(1.2)
      .child(div().font_semibold().truncate().child(room.name))
      .child(div().text_color(colors.primary).truncate().child(text.room_running(running)))
      .child(div().text_color(waiting ? colors.warning : colors.muted_foreground).truncate()
        .child(text.room_approvals(waiting))));
}
function room(view,value,index,scale) {
  const [column,row] = ROOM_CELLS[index], colors = theme().colors;
  const tile = div().id(`activity-room-tile-${value?.key ?? index}`).absolute()
    .left(column * TILE_SIZE * scale).top(row * TILE_SIZE * scale)
    .w(TILE_SIZE * scale).h(TILE_SIZE * scale)
    .child(sprite(`activity-room-base-${index}`,0,TILE_SIZE * scale));
  if (value) tile.child(board(view,value,scale));
  for (let seat = 0;seat < 6;seat += 1) {
    const item = value?.visible.find(item => item.seat % 6 === seat), position = seatPosition(seat);
    const lit = item && !item.approval && item.phase === 'turn_tools_running';
    tile.child(div().id(`activity-desk-${value?.key ?? index}-${seat}`).absolute()
      .left(position.left * scale).top(position.top * scale).w(DESK_SIZE * scale).h(DESK_SIZE * scale)
      .child(sprite(`activity-monitor-${value?.key ?? index}-${seat}`,lit ? 2 : 1,DESK_SIZE * scale)));
  }
  if (!value) return tile.opacity(0.35);
  if (value.pages > 1) tile.child(div().id(`activity-room-pages-${value.key}`).absolute()
    .left(96 * scale).bottom(5 * scale).h_flex().items_center().gap_1().text_xs().text_color(colors.muted_foreground)
    .child(new Button(`activity-room-prev-${value.key}`).ghost().size('small').p_0().w(24).h(24)
      .disabled(value.page === 0).tooltip(view.text.previous).child(new Icon('icons/chevron-left.svg').size('xsmall'))
      .on_click((_event,cx) => {view.floor.turnRoom(value.key,-1,value.pages);cx.notify();}))
    .child(`${value.page + 1} / ${value.pages}`)
    .child(new Button(`activity-room-next-${value.key}`).ghost().size('small').p_0().w(24).h(24)
      .disabled(value.page + 1 === value.pages).tooltip(view.text.next).child(new Icon('icons/chevron-right.svg').size('xsmall'))
      .on_click((_event,cx) => {view.floor.turnRoom(value.key,1,value.pages);cx.notify();})));
  return tile;
}
function person(view,item,left,top,scale,approval = false) {
  const id = item.kind === 'terminal' ? `activity-terminal-${item.id}` : `activity-${item.id}`;
  const status = approval ? null : item.waiting === 'input' ? '?' : item.lane === 'failed' ? '!'
    : item.lane === 'completed' ? '✓' : item.kind === 'terminal' ? '>_' : null;
  const art = approval ? 12 + item.character : 8 + item.character;
  view.targets.set(id,item);
  return div().id(`${id}-position`).absolute().left(left * scale).top(top * scale)
    .w(PERSON_SIZE * scale).h((PERSON_SIZE + 18) * scale)
    .child(ComposedButton.new(id,{size:PERSON_SIZE * scale,
      label:`${item.title}, ${item.status}, ${item.project}`,tooltip:`${item.title} · ${item.status}`})
      .child(div().relative().w(PERSON_SIZE * scale).h(PERSON_SIZE * scale)
        .child(sprite(id,art,PERSON_SIZE * scale))
        .children(status ? [div().absolute().top(0).right(0)
          .child(new Tag().variant(variants[item.lane] ?? 'secondary').size('small').rounded_full().child(status))] : [])));
}
export function scene(view,model,scale) {
  const colors = theme().colors;
  const world = div().id('activity-world').relative().flex_shrink(0)
    .w(WORLD_SIZE * scale).h(WORLD_SIZE * scale)
    .children(Array.from({length:8},(_,index) => room(view,model.visible[index],index,scale)))
    .child(div().id('activity-plaza').absolute().left(TILE_SIZE * scale).top(TILE_SIZE * scale)
      .w(TILE_SIZE * scale).h(TILE_SIZE * scale).rounded_lg().bg(colors.group_box).border_1().border_color(colors.border)
      .child(div().absolute().top(20 * scale).w_full().text_center().text_size(14 * scale).line_height(1.2).font_semibold()
        .text_color(colors.muted_foreground).child(view.text.approval_plaza))
      .children(model.approvals.length ? [] : [div().absolute().top(126 * scale).w_full()
        .text_center().text_size(12 * scale).text_color(colors.muted_foreground).child(view.text.no_approvals)])
      .child(new Button('activity-approvals').ghost().absolute().bottom(8 * scale).left(84 * scale)
        .w(152 * scale).size('small').label(view.text.approval_count(model.approvals.length))
        .disabled(model.approvals.length === 0).on_click((_event,cx) => view.inspectApprovals(cx))));
  const people = [];
  model.visible.forEach((value,index) => {
    const [column,row] = ROOM_CELLS[index];
    for (const item of value.visible) if (!item.approval) {
      const desk = seatPosition(item.seat % 6);
      people.push({item,left:column * TILE_SIZE + desk.left + 5,
        top:row * TILE_SIZE + desk.top + 31,approval:false});
    }
  });
  model.approvals.slice(0,9).forEach((item,index) => people.push({item,
    left:TILE_SIZE + 48 + index % 3 * 82,top:TILE_SIZE + 48 + Math.floor(index / 3) * 70,approval:true}));
  return world.children(people.sort((left,right) => left.top - right.top)
    .map(value => person(view,value.item,value.left,value.top,scale,value.approval)));
}
