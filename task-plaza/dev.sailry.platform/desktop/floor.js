// Presentation placement only; activity lanes remain owned by the shared Client.
import {sections} from './state.js';
export const ROOM_COUNT = 8;
export const SEAT_COUNT = 6;
const priority = item => item.lane === 'running' ? 0 : item.lane === 'waiting' ? 1 : 2;
const identity = item => `${item.kind}:${item.id}`;

export function character(id) {
  let hash = 0;
  for (const value of id) hash = (hash * 31 + value.charCodeAt(0)) >>> 0;
  return hash % 6;
}
export class Floor {
  constructor() {
    this.node = null;this.page = 0;
    this.seats = new Map();this.roomPages = new Map();
  }
  assign(node,rooms) {
    if (node !== this.node) {
      this.node = node;this.page = 0;this.seats.clear();this.roomPages.clear();
    }
    const active = new Set(rooms.map(room => room.key));
    for (const key of this.seats.keys()) if (!active.has(key)) {
      this.seats.delete(key);this.roomPages.delete(key);
    }
    for (const room of rooms) {
      const positions = this.seats.get(room.key) ?? new Map();
      // State changes may move active work forward; peers keep their prior order.
      room.items.sort((left,right) => priority(left) - priority(right)
        || (positions.get(identity(left)) ?? Number.MAX_SAFE_INTEGER) - (positions.get(identity(right)) ?? Number.MAX_SAFE_INTEGER));
      const assigned = new Map();
      room.items.forEach((item,seat) => {item.seat = seat;assigned.set(identity(item),seat);});
      this.seats.set(room.key,assigned);
      room.pages = Math.max(1,Math.ceil(room.items.length / SEAT_COUNT));
      room.page = Math.min(this.roomPages.get(room.key) ?? 0,room.pages - 1);
      this.roomPages.set(room.key,room.page);
      room.visible = room.items.filter(item => Math.floor(item.seat / SEAT_COUNT) === room.page);
    }
    this.page = Math.min(this.page,Math.max(0,Math.ceil(rooms.length / ROOM_COUNT) - 1));
  }
  turnRoom(key,direction,maximum) {
    this.roomPages.set(key,Math.max(0,Math.min(maximum - 1,(this.roomPages.get(key) ?? 0) + direction)));
  }
}
export function layout(catalog,previews,text,floor) {
  if (!catalog) return {rooms:[],visible:[],approvals:[],pages:1,counts:{running:0,waiting:0,idle:0}};
  const groups = sections(catalog,previews,text);
  const sessions = new Map(catalog.sessions.map(session => [session.id,session]));
  const rooms = catalog.projects.map(project => ({id:project.id,key:project.id,name:project.name,items:[]}));
  const byId = new Map(rooms.map(room => [room.id,room]));
  const approvals = [], counts = {running:0,waiting:0,idle:0};
  for (const lane of Object.values(groups)) for (const group of lane) {
    if (!byId.has(group.id)) {
      const room = {id:group.id,key:group.id ?? 'unassigned',name:group.name,items:[]};
      rooms.push(room);byId.set(group.id,room);
    }
    for (const card of group.cards) {
      const session = sessions.get(card.id);
      const approval = card.kind === 'session' && card.lane === 'waiting' && session?.activity.waiting === 'approval';
      const item = {...card,approval,waiting:session?.activity.waiting ?? null,character:character(card.id)};
      byId.get(group.id).items.push(item);
      if (approval) approvals.push(item);
      if (card.lane === 'running') counts.running += 1;
      else if (card.lane === 'waiting') counts.waiting += 1;
      else if (card.lane === 'idle') counts.idle += 1;
    }
  }
  floor.assign(catalog.node,rooms);
  return {rooms,visible:rooms.slice(floor.page * ROOM_COUNT,(floor.page + 1) * ROOM_COUNT),
    approvals,pages:Math.max(1,Math.ceil(rooms.length / ROOM_COUNT)),counts};
}
