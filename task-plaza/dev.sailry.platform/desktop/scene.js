import {div} from 'gpui-kit';
import {Button,Icon,Tag} from 'gpui-component';
import {theme} from 'sailry';
import {ComposedButton} from 'sailry/ui';
import {environment,sprite} from './art.js';
import {ROOMS,WORLD_WIDTH,WORLD_HEIGHT,PERSON_SIZE,DESK_WIDTH,SEATED,STANDING,ATRIUM,seatPosition,approvalPosition} from './geometry.js';
export const variants = {waiting:'warning',running:'primary',completed:'success',failed:'danger',idle:'secondary'};

function board(view,value,index,scale) {
  const {board:bounds} = ROOMS[index], {text} = view;
  const running = value?.items.filter(item => item.lane === 'running').length ?? 0;
  const waiting = value?.items.filter(item => item.approval).length ?? 0;
  // Whiteboard ink belongs to the illustration's fixed light material, not a
  // second application palette. Controls around the scene keep Kit tokens.
  const label = div().v_flex().size_full().min_w_0().justify_center().items_center().text_center().gap_1()
    .text_color('#253041').text_size(12 * scale).line_height(1.15)
    .child(div().font_semibold().truncate().child(value?.name ?? text.activity_no_project))
    .child(div().text_size(10 * scale).truncate().child(text.room_summary(running,waiting)));
  const board = new Button(`plaza-room-${value?.key ?? index}`).ghost().p_0().absolute()
    .left(bounds.x * scale).top(bounds.y * scale).w(bounds.width * scale).h(bounds.height * scale)
    .disabled(!value).tooltip(value?.name ?? text.activity_no_project).child(label);
  if (value) board.on_click((_event,cx) => view.inspectRoom(value.key,cx));
  return board;
}
function walls(index,scale,front = false) {
  const {crop,bounds} = ROOMS[index], [x,y,width,height] = crop;
  // The bottom strip is drawn after workers, including chair/foot occlusion.
  const split = height - 48, source = front ? [x,y + split,width,48] : [x,y,width,split];
  const h = bounds.height * source[3] / height;
  return div().id(`plaza-room-${front ? 'front' : 'back'}-${index}`).absolute()
    .left(bounds.x * scale).top((bounds.y + (front ? bounds.height - h : 0)) * scale)
    .w(bounds.width * scale).h(h * scale)
    .child(environment(`plaza-wall-${front ? 'front' : 'back'}-${index}`,source,bounds.width * scale,h * scale));
}
function paging(view,value,index,scale) {
  if (!value || value.pages < 2) return null;
  const bounds = ROOMS[index].board, colors = theme().colors;
  return div().id(`plaza-room-pages-${value.key}`).absolute()
    .left((bounds.x + bounds.width + 3) * scale).top(bounds.y * scale)
    .v_flex().items_center().text_size(9 * scale).text_color(colors.muted_foreground)
    .child(new Button(`plaza-room-prev-${value.key}`).ghost().size('small').p_0().w(20).h(18)
      .disabled(value.page === 0).tooltip(view.text.previous).child(new Icon('icons/chevron-left.svg').size('xsmall'))
      .on_click((_event,cx) => {view.floor.turnRoom(value.key,-1,value.pages);cx.notify();}))
    .child(`${value.page + 1}/${value.pages}`)
    .child(new Button(`plaza-room-next-${value.key}`).ghost().size('small').p_0().w(20).h(18)
      .disabled(value.page + 1 === value.pages).tooltip(view.text.next).child(new Icon('icons/chevron-right.svg').size('xsmall'))
      .on_click((_event,cx) => {view.floor.turnRoom(value.key,1,value.pages);cx.notify();}));
}
function person(view,item,position,scale,approval = false) {
  const id = item.kind === 'terminal' ? `plaza-terminal-${item.id}` : `plaza-${item.id}`;
  const dimension = approval ? 64 : PERSON_SIZE, size = dimension * scale, index = approval ? STANDING[item.character] : SEATED[item.character];
  const status = approval ? null : item.waiting === 'input' ? '?' : item.lane === 'failed' ? '!'
    : item.lane === 'completed' ? '✓' : item.kind === 'terminal' ? '>_' : null;
  view.targets.set(id,item);
  return div().id(`${id}-position`).absolute().left((position.x - dimension / 2) * scale)
    .top((position.y - dimension) * scale).w(size).h(size)
    .child(ComposedButton.new(id,{size,label:`${item.title}, ${item.status}, ${item.project}`,
      tooltip:`${item.title} · ${item.status}`})
      .child(div().relative().w(size).h(size).h_flex().justify_center()
        .child(sprite(id,index,size))
        .children(status ? [div().absolute().top(14 * scale).right(0)
          .child(new Tag().variant(variants[item.lane] ?? 'secondary').size('small').rounded_full().child(status))] : [])));
}
export function scene(view,model,scale) {
  const world = div().id('plaza-world').relative().flex_shrink(0)
    .w(WORLD_WIDTH * scale).h(WORLD_HEIGHT * scale)
    .child(div().id('plaza-foundation').absolute().left(0).top(0).w(WORLD_WIDTH * scale).h(550 * scale)
      .child(environment('plaza-floor',[0,35,949,550],WORLD_WIDTH * scale,550 * scale)))
    .children(ROOMS.map((_room,index) => walls(index,scale)))
    .child(div().id('plaza-atrium').absolute().left(ATRIUM.x * scale).top(ATRIUM.y * scale)
      .w(ATRIUM.width * scale).h(ATRIUM.height * scale));
  const furnishings = [], people = [];
  for (let room = 0;room < 8;room += 1) {
    const value = model.visible[room];
    for (let seat = 0;seat < 6;seat += 1) {
      const position = seatPosition(room,seat), item = value?.visible.find(item => item.seat % 6 === seat);
      const lit = item && !item.approval && item.phase === 'turn_tools_running';
      const deskHeight = 30;
      const identity = `${value?.key ?? room}-${seat}`;
      furnishings.push({depth:position.y,element:div().id(`plaza-desk-${identity}`).absolute()
        .left((position.x - DESK_WIDTH / 2) * scale).top((position.y - 17 - deskHeight) * scale)
        .w(DESK_WIDTH * scale).h(deskHeight * scale)
        .child(sprite(`plaza-monitor-${identity}`,lit ? 1 : 0,deskHeight * scale,DESK_WIDTH * scale))});
      if (item && !item.approval) people.push({item,position});
      else furnishings.push({depth:position.y + 0.1,element:div().id(`plaza-chair-${identity}`).absolute()
        .left((position.x - 12) * scale).top((position.y - 26) * scale).w(24 * scale).h(26 * scale)
        .child(sprite(`plaza-empty-chair-${identity}`,2,26 * scale))});
    }
  }
  model.approvals.slice(0,6).forEach((item,index) => people.push({item,position:approvalPosition(index),approval:true}));
  return world.children([...furnishings,...people.map(value => ({depth:value.position.y + 0.1,
      element:person(view,value.item,value.position,scale,value.approval)}))]
      .sort((left,right) => left.depth - right.depth).map(value => value.element))
    .children(ROOMS.map((_room,index) => walls(index,scale,true)))
    // The entrance is its own layer and hides the front-center worker's feet.
    .child(div().id('plaza-entry').absolute().left(444 / 949 * WORLD_WIDTH * scale).top(449 * scale)
      .w(60 / 949 * WORLD_WIDTH * scale).h(64 * scale)
      .child(environment('plaza-entry-door',[433,1512,86,77],60 / 949 * WORLD_WIDTH * scale,64 * scale)))
    .children(ROOMS.map((_room,index) => board(view,model.visible[index],index,scale)))
    .children(ROOMS.map((_room,index) => paging(view,model.visible[index],index,scale)).filter(Boolean));
}
