import assert from 'node:assert/strict';
import test from 'node:test';
import {Floor,layout,SEAT_COUNT,ROOM_COUNT} from '../dev.sailry.platform/desktop/floor.js';
import {messages} from '../dev.sailry.platform/desktop/locales.js';
const text=messages('en');
function catalog(count=4) {
  const sessions=Array.from({length:count},(_,index)=>({id:`s${index}`,project:'project',worktree:'tree',archived:false,delegation:null,
    activity:{title:`Task ${index}`,queued:0,waiting:null,run:{turn:`t${index}`,status:'running'}}}));
  return {node:'node',projects:[{id:'project',name:'Project'}],worktrees:[{id:'tree',project:'project',path:'/project'}],
    sessions,session_lanes:Object.fromEntries(sessions.map(session=>[session.id,'running'])),terminals:[],terminal_lanes:{},unread_terminals:[]};
}
const render=(data,floor)=>layout(data,new Map(),text,floor);

test('seats remain stable across state changes and input ordering',()=>{
  const data=catalog(),floor=new Floor(),first=render(data,floor);
  const seats=new Map(first.rooms[0].items.map(item=>[item.id,item.seat]));
  data.sessions.reverse();data.sessions[1].activity.waiting='approval';data.session_lanes[data.sessions[1].id]='waiting';
  const second=render(data,floor);
  for(const item of second.rooms[0].items)assert.equal(item.seat,seats.get(item.id));
  assert.deepEqual(second.approvals.map(item=>item.id),[data.sessions[1].id]);
  data.sessions[1].activity.waiting=null;data.session_lanes[data.sessions[1].id]='running';
  assert.equal(render(data,floor).approvals.length,0);
});

test('more than six sessions and eight projects remain reachable',()=>{
  const data=catalog(14),floor=new Floor();
  for(let index=0;index<9;index++)data.projects.push({id:`p${index}`,name:`Project ${index}`});
  let model=render(data,floor);assert.equal(model.visible.length,ROOM_COUNT);assert.equal(model.pages,2);
  const room=model.rooms[0];assert.equal(room.visible.length,SEAT_COUNT);assert.equal(room.pages,3);
  const ids=new Set(room.visible.map(item=>item.id));
  for(let page=1;page<3;page++) {
    floor.turnRoom(room.key,1,room.pages);model=render(data,floor);
    for(const item of model.rooms[0].visible)ids.add(item.id);
  }
  assert.equal(ids.size,14);floor.page=1;model=render(data,floor);assert.equal(model.visible.length,2);
  data.sessions[0].activity.waiting='approval';data.session_lanes.s0='waiting';
  assert.equal(render(data,floor).approvals[0].id,'s0');
});

test('removed seats are reused and another node clears placement',()=>{
  const data=catalog(),floor=new Floor(),first=render(data,floor),seat=first.rooms[0].items.find(item=>item.id==='s0').seat;
  data.sessions=data.sessions.filter(session=>session.id!=='s0');
  render(data,floor);data.sessions.push({...data.sessions[0],id:'new'});data.session_lanes.new='running';
  assert.equal(render(data,floor).rooms[0].items.find(item=>item.id==='new').seat,seat);
  floor.page=5;floor.roomPages.set('project',3);data.node='replacement';
  render(data,floor);assert.equal(floor.page,0);assert.equal(floor.roomPages.get('project'),0);
});

test('stale approval flags and hidden sessions stay outside the plaza',()=>{
  const data=catalog();data.sessions[0].activity.waiting='approval';data.session_lanes.s0='completed';
  data.sessions[1].activity.waiting='approval';data.session_lanes.s1='waiting';data.sessions[1].archived=true;
  data.sessions[2].activity.waiting='approval';data.session_lanes.s2='waiting';data.sessions[2].delegation={session:'parent'};
  const model=render(data,new Floor());assert.equal(model.approvals.length,0);assert.equal(model.rooms[0].items.length,2);
});
