import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const root=new URL('../dev.sailry.platform/desktop/',import.meta.url);
const sources=await Promise.all(['locales','state','floor','geometry','art','scene','ground','details','view'].map(async name =>
  (await readFile(new URL(`${name}.js`,root),'utf8')).replace(/^import .*;\n/gm,'').replace(/^export /gm,'')));
const plain=value=>JSON.parse(JSON.stringify(value));

function fixture(count=0) {
  const nodes=new Map(),opened=[];
  function element(kind='div',id=null,props={}) {
    const value={kind,selector:id,props,items:[],style:{}};
    const proxy=new Proxy(value,{get(target,key) {
      if(key==='id')return id=>{target.selector=id;nodes.set(id,proxy);return proxy;};
      if(key==='child')return child=>{target.items.push(child);return proxy;};
      if(key==='children')return children=>{target.items.push(...children);return proxy;};
      if(key in target)return target[key];
      return (...args)=>{target.style[key]=args;return proxy;};
    }});
    if(id)nodes.set(id,proxy);return proxy;
  }
  const native=Object.fromEntries(['Header','Workspace','Image','Conversation','ComposedButton','CardButton','PanelHeader','IconButton','EmptyState','Loading','ClampedText'].map(kind=>[kind,{new:(id,props)=>{
    const result=element(kind,id,props);
    if(kind==='ClampedText')result.child(props.text);
    return result;
  }}]));
  const api=vm.runInNewContext(`${sources.join('\n')}\n({render,ground,layout,Floor,messages,WORLD_WIDTH,WORLD_HEIGHT,ROOMS,PERSON_SIZE})`,{
    div:()=>element(),Button:function(id){return element('Button',id);},Icon:function(id){return element('Icon',id);},
    Tag:function(){return element('Tag');},Resizable:function(id){return element('Resizable',id);},ResizablePanel:function(){return element('ResizablePanel');},...native,pageInsets:()=>({rail_width:56}),
    theme:()=>({colors:{surface:'surface',foreground:'foreground',border:'border',muted_foreground:'muted',primary:'primary',warning:'warning',group_box:'group'}}),
    PathBuilder:{stroke:width=>{
      const path={width,commands:[],build(){return this;}};
      for(const method of ['move_to','line_to','curve_to','dash_array'])path[method]=(...args)=>{path.commands.push([method,...args]);return path;};
      return path;
    }},Background:{solid:()=>element('Background')},
    window:{viewport_size:()=>({width:1440,height:1000}),paint_path:path=>element('NativePath',null,{path})},openActivityTarget:(...args)=>opened.push(args),
  });
  const sessions=Array.from({length:count},(_,index)=>({id:`session-${index}`,project:'project',worktree:'tree',archived:false,delegation:null,
    activity:{title:`Task ${index}`,queued:0,waiting:null,run:{turn:`turn-${index}`,status:'running'}}}));
  const view={text:api.messages('en'),floor:new api.Floor(),panelOpen:false,selected:null,
    board:{connected:true,previews:new Map(),catalog:{node:'captured',projects:[{id:'project',name:'Project'}],
      worktrees:[{id:'tree',project:'project',path:'/fixture'}],sessions,terminals:[],unread_terminals:[],
      session_lanes:Object.fromEntries(sessions.map(session=>[session.id,'running'])),terminal_lanes:{}}},
    inspect(item){this.selected={kind:'session',id:item.id,title:item.title};this.panelOpen=true;},
    inspectRoom(id){this.selected={kind:'room',id};this.panelOpen=true;},
    inspectApprovals(){this.selected={kind:'approvals'};this.panelOpen=true;},closeDetails(){this.panelOpen=false;},
  };
  return {view,nodes,opened,...api,render(){nodes.clear();return api.render(view);},
    click(id){if(['ComposedButton','CardButton'].includes(nodes.get(id).kind))view.inspect(view.targets.get(id));
      else if(nodes.get(id).kind==='IconButton') {
        if(id==='plaza-open-conversation')opened.push(['session',view.selected.id]);
        view.closeDetails();
      }else nodes.get(id).style.on_click[0]({}, {notify(){}});}};
}

test('eight rooms surround a plaza with six desks each',()=>{
  const setup=fixture(4);setup.render();
  assert.equal([...setup.nodes.keys()].filter(id=>id.startsWith('plaza-room-outline-')).length,8);
  assert.equal([...setup.nodes.keys()].filter(id=>/^plaza-desk-/.test(id)).length,48);
  const plaza=setup.nodes.get('plaza-atrium');
  assert.equal(plaza.style.bg,undefined);assert.equal(plaza.style.border_1,undefined);
  assert.equal(setup.nodes.get('plaza-world').style.w[0]/setup.nodes.get('plaza-world').style.h[0],setup.WORLD_WIDTH/setup.WORLD_HEIGHT);
  assert.ok([...setup.nodes.values()].filter(node=>node.kind==='Image').every(node=>node.props.fit==='fill'));
  for(let index=0;index<4;index++)assert.equal(setup.nodes.get(`plaza-session-${index}`).kind,'ComposedButton');
  assert.equal([...setup.nodes.values()].filter(node=>node.kind==='Conversation').length,0);
  assert.equal(setup.nodes.get('plaza-room-project').kind,'Button');
  assert.ok(setup.nodes.get('plaza-room-project').style.left[0]>0);
  assert.ok(setup.nodes.has('plaza-viewport'));
});

test('watermark dashes stay aligned across repeated rows',()=>{
  const setup=fixture(),result=setup.ground(1603,947),path=result.items[1].props.path;
  assert.ok(path.commands.length<200,'watermark cost must not grow with the number of tiles');
  assert.deepEqual(plain(path.commands[0]),['dash_array',[4,28]]);
  for(let index=1;index<path.commands.length;index+=2) {
    const [,x,y]=path.commands[index], [,right,bottom]=path.commands[index+1];
    assert.equal(((right-x)+(bottom-y))%32,0,'each row must end on a full dash period');
  }
});

test('shared sidebar releases conversations on close or replacement',()=>{
  const setup=fixture(2);setup.render();
  const full=setup.nodes.get('plaza-world').style.w[0];
  setup.click('plaza-session-0');setup.render();
  assert.deepEqual(plain(setup.nodes.get('plaza-detail-chat-session-0').props),{active:true,session:'session-0'});
  assert.ok(setup.nodes.has('plaza-detail-panel'));
  assert.equal(setup.nodes.get('plaza-detail-header').kind,'PanelHeader');
  assert.equal(setup.nodes.get('plaza-workspace').kind,'Workspace');
  assert.equal(setup.nodes.get('plaza-workspace').props.has_details,true);
  assert.equal(setup.nodes.get('plaza-workspace').items[1],setup.nodes.get('plaza-detail-panel'));
  assert.equal(setup.nodes.has('plaza-columns'),false);
  assert.ok(setup.nodes.get('plaza-world').style.w[0]<full);
  assert.equal([...setup.nodes.values()].filter(node=>node.kind==='Modal').length,0);
  setup.click('plaza-session-1');setup.render();
  assert.equal(setup.nodes.get('plaza-detail-chat-session-0').props.active,false);
  assert.deepEqual(plain(setup.nodes.get('plaza-detail-chat-session-1').props),{active:true,session:'session-1'});
  setup.click('plaza-detail-close');setup.render();
  assert.equal(setup.nodes.get('plaza-detail-chat-session-1').props.active,false);
  assert.equal(setup.nodes.has('plaza-detail-panel'),false);
  assert.equal(setup.nodes.get('plaza-workspace').props.has_details,false);
  setup.click('plaza-session-0');setup.render();setup.click('plaza-open-conversation');setup.render();
  assert.deepEqual(setup.opened,[['session','session-0']]);
  assert.equal(setup.nodes.get('plaza-detail-chat-session-0').props.active,false);
});

test('approval switches directly to the plaza and returns to its desk',()=>{
  const setup=fixture(1),session=setup.view.board.catalog.sessions[0];
  setup.render();const seated=plain(setup.nodes.get('plaza-session-0-position').style);
  session.activity.waiting='approval';setup.view.board.catalog.session_lanes[session.id]='waiting';setup.render();
  const waiting=setup.nodes.get('plaza-session-0-position');
  assert.ok(waiting.style.left[0] > seated.left[0]);
  setup.click('plaza-session-0');setup.render();
  assert.equal(setup.nodes.get('plaza-detail-chat-session-0').props.session,session.id);
  session.activity.waiting=null;setup.view.board.catalog.session_lanes[session.id]='running';setup.render();
  setup.click('plaza-detail-close');setup.render();
  assert.deepEqual(plain(setup.nodes.get('plaza-session-0-position').style),seated);
});

test('overflow retains access to every session',()=>{
  const setup=fixture(8);setup.render();
  assert.equal([...setup.nodes.keys()].filter(id=>/^plaza-session-\d+$/.test(id)).length,6);
  setup.click('plaza-room-next-project');setup.render();
  assert.equal([...setup.nodes.keys()].filter(id=>/^plaza-session-\d+$/.test(id)).length,2);
  setup.click('plaza-room-project');setup.render();
  assert.equal([...setup.nodes.values()].filter(node=>node.kind==='CardButton').length,8);
});

test('room lists show current previews without replacing the scene',()=>{
  const setup=fixture(1);setup.view.board.previews.set('session-0',{turn:'turn-0',text:'## Done\n**Checked**'});
  setup.render();setup.click('plaza-room-project');const result=setup.render();
  assert.ok(setup.nodes.has('plaza-world'));
  function content(node){return typeof node==='string'?node:(node?.items??[]).map(content).join(' ');}
  assert.match(content(result),/Done Checked/);
});

test('only active work lights the computer screen',()=>{
  const setup=fixture(1),session=setup.view.board.catalog.sessions[0];
  setup.render();
  const width=setup.nodes.get('plaza-desk-project-0').style.w[0];
  const monitor=()=>setup.nodes.get('plaza-monitor-project-0-clip').items[0].style.left[0];
  const unlit=-53*(width/216),lit=-366*(width/216);
  assert.ok(Math.abs(monitor()-lit)<1e-8);
  session.activity.run.status='queued';setup.render();assert.ok(Math.abs(monitor()-unlit)<1e-8);
  session.activity.run.status='running';session.activity.waiting='input';
  setup.view.board.catalog.session_lanes[session.id]='waiting';setup.render();assert.ok(Math.abs(monitor()-unlit)<1e-8);
  session.activity.waiting='approval';setup.render();assert.ok(Math.abs(monitor()-unlit)<1e-8);
});

test('all furniture shares a uniform scale inside disjoint room boundaries',()=>{
  const setup=fixture(4);setup.render();
  const world=setup.nodes.get('plaza-world'),scale=world.style.w[0]/setup.WORLD_WIDTH;
  for(let index=0;index<8;index++) {
    const bounds=setup.ROOMS[index].bounds;
    for(let seat=0;seat<6;seat++) {
      const key=index===0?'project':index;
      const desk=setup.nodes.get(`plaza-desk-${key}-${seat}`).style;
      assert.ok(desk.left[0]>=bounds.x*scale);
      assert.ok(desk.top[0]>=bounds.y*scale);
      assert.ok(desk.left[0]+desk.w[0]<=(bounds.x+bounds.width)*scale);
      assert.ok(desk.top[0]+desk.h[0]<=(bounds.y+bounds.height)*scale);
      assert.ok(Math.abs(desk.w[0]/desk.h[0]-216/185)<1e-8);
    }
    for(let other=index+1;other<8;other++) {
      const second=setup.ROOMS[other].bounds;
      assert.ok(bounds.x+bounds.width<=second.x||second.x+second.width<=bounds.x||
        bounds.y+bounds.height<=second.y||second.y+second.height<=bounds.y);
    }
  }
  assert.ok(setup.nodes.has('plaza-ground'));
  assert.ok([...setup.nodes.values()].filter(node=>node.kind==='Image').every(node=>!node.props.path.includes('environment')));
});

test('approval groups fit without touching adjacent rooms',()=>{
  for(const count of [1,3,6]) {
    const setup=fixture(count);
    for(const session of setup.view.board.catalog.sessions) {
      session.activity.waiting='approval';setup.view.board.catalog.session_lanes[session.id]='waiting';
    }
    setup.render();
    const plaza=setup.nodes.get('plaza-atrium').style;
    const people=Array.from({length:count},(_,index)=>setup.nodes.get(`plaza-session-${index}-position`).style);
    for(const person of people) {
      assert.ok(person.left[0]>=plaza.left[0]);assert.ok(person.top[0]>=plaza.top[0]);
      assert.ok(person.left[0]+person.w[0]<=plaza.left[0]+plaza.w[0]);
      assert.ok(person.top[0]+person.h[0]<=plaza.top[0]+plaza.h[0]);
    }
    assert.ok(setup.nodes.get('plaza-room-6').style.top[0]>plaza.top[0]+plaza.h[0]);
    for(let index=0;index<people.length;index++)for(let other=index+1;other<people.length;other++) {
      const first=people[index],second=people[other];
      assert.ok(first.left[0]+first.w[0]<=second.left[0]||second.left[0]+second.w[0]<=first.left[0]||
        first.top[0]+first.h[0]<=second.top[0]||second.top[0]+second.h[0]<=first.top[0]);
    }
  }
});

test('pending catalogs keep room selection unavailable',()=>{
  const setup=fixture();setup.view.board.catalog=null;setup.render();
  assert.equal(setup.nodes.get('plaza-loading').kind,'Loading');
  assert.equal(setup.nodes.has('plaza-world'),false);
  setup.view.board.error=true;setup.render();
  assert.equal(setup.nodes.get('plaza-retry').kind,'Button');
  assert.equal(setup.nodes.has('plaza-loading'),false);
});
