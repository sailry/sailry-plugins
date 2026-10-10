import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const root=new URL('../dev.sailry.platform/desktop/',import.meta.url);
const sources=await Promise.all(['locales','state','floor','geometry','art','scene','dialogs','view'].map(async name =>
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
  const native=Object.fromEntries(['Header','Image','Modal','Conversation','ComposedButton'].map(kind=>[kind,{new:(id,props)=>element(kind,id,props)}]));
  const api=vm.runInNewContext(`${sources.join('\n')}\n({render,layout,Floor,messages,WORLD_WIDTH,WORLD_HEIGHT,ROOMS,PERSON_SIZE})`,{
    div:()=>element(),Button:function(id){return element('Button',id);},Icon:function(id){return element('Icon',id);},
    Tag:function(){return element('Tag');},...native,pageInsets:()=>({rail_width:56}),
    theme:()=>({colors:{surface:'surface',foreground:'foreground',border:'border',muted_foreground:'muted',primary:'primary',warning:'warning',group_box:'group'}}),
    window:{viewport_size:()=>({width:1440,height:1000})},openActivityTarget:(...args)=>opened.push(args),
  });
  const sessions=Array.from({length:count},(_,index)=>({id:`session-${index}`,project:'project',worktree:'tree',archived:false,delegation:null,
    activity:{title:`Task ${index}`,queued:0,waiting:null,run:{turn:`turn-${index}`,status:'running'}}}));
  const view={text:api.messages('en'),floor:new api.Floor(),dialogOpen:false,selected:null,
    board:{connected:true,previews:new Map(),catalog:{node:'captured',projects:[{id:'project',name:'Project'}],
      worktrees:[{id:'tree',project:'project',path:'/fixture'}],sessions,terminals:[],unread_terminals:[],
      session_lanes:Object.fromEntries(sessions.map(session=>[session.id,'running'])),terminal_lanes:{}}},
    inspect(item){this.selected={kind:'session',id:item.id,title:item.title};this.dialogOpen=true;},
    inspectRoom(id){this.selected={kind:'room',id};this.dialogOpen=true;},
    inspectApprovals(){this.selected={kind:'approvals'};this.dialogOpen=true;},closeDetails(){this.dialogOpen=false;},
  };
  return {view,nodes,opened,...api,render(){nodes.clear();return api.render(view);},
    click(id){if(nodes.get(id).kind==='ComposedButton')view.inspect(view.targets.get(id));else nodes.get(id).style.on_click[0]({}, {notify(){}});}};
}

test('eight rooms surround a plaza with six desks each',()=>{
  const setup=fixture(4);setup.render();
  assert.equal([...setup.nodes.keys()].filter(id=>id.startsWith('plaza-room-back-')).length,8);
  assert.equal([...setup.nodes.keys()].filter(id=>/^plaza-desk-/.test(id)).length,48);
  const plaza=setup.nodes.get('plaza-atrium');
  assert.equal(plaza.style.bg,undefined);assert.equal(plaza.style.border_1,undefined);
  assert.equal(setup.nodes.get('plaza-world').style.w[0]/setup.nodes.get('plaza-world').style.h[0],setup.WORLD_WIDTH/setup.WORLD_HEIGHT);
  assert.ok([...setup.nodes.values()].filter(node=>node.kind==='Image').every(node=>node.props.fit==='fill'));
  for(let index=0;index<4;index++)assert.equal(setup.nodes.get(`plaza-session-${index}`).kind,'ComposedButton');
  assert.equal(setup.nodes.get('plaza-detail-chat').props.active,false);
  assert.equal(setup.nodes.get('plaza-room-project').kind,'Button');
  assert.ok(setup.nodes.get('plaza-room-project').style.left[0]>0);
  assert.ok(setup.nodes.has('plaza-viewport'));
});

test('characters open native conversations and release on dismissal',()=>{
  const setup=fixture(1);setup.render();setup.click('plaza-session-0');setup.render();
  assert.deepEqual(plain(setup.nodes.get('plaza-detail-chat').props),{active:true,session:'session-0'});
  assert.equal(setup.nodes.get('plaza-dialog').kind,'Modal');
  assert.equal(setup.nodes.get('plaza-dialog').props.title,'Task 0');
  setup.click('plaza-open-conversation');setup.render();
  assert.deepEqual(setup.opened,[['session','session-0']]);
  assert.equal(setup.nodes.get('plaza-detail-chat').props.active,false);
});

test('approval switches directly to the plaza and returns to its desk',()=>{
  const setup=fixture(1),session=setup.view.board.catalog.sessions[0];
  setup.render();const seated=plain(setup.nodes.get('plaza-session-0-position').style);
  session.activity.waiting='approval';setup.view.board.catalog.session_lanes[session.id]='waiting';setup.render();
  const waiting=setup.nodes.get('plaza-session-0-position');
  assert.ok(waiting.style.left[0] > seated.left[0]);
  setup.click('plaza-session-0');setup.render();
  assert.equal(setup.nodes.get('plaza-detail-chat').props.session,session.id);
  session.activity.waiting=null;setup.view.board.catalog.session_lanes[session.id]='running';setup.render();
  assert.deepEqual(plain(setup.nodes.get('plaza-session-0-position').style),seated);
});

test('overflow and zoom retain access to every session',()=>{
  const setup=fixture(8);setup.render();
  assert.equal([...setup.nodes.keys()].filter(id=>/^plaza-session-\d+$/.test(id)).length,6);
  setup.click('plaza-room-next-project');setup.render();
  assert.equal([...setup.nodes.keys()].filter(id=>/^plaza-session-\d+$/.test(id)).length,2);
  setup.click('plaza-room-project');setup.render();
  assert.equal([...setup.nodes.keys()].filter(id=>/^plaza-detail-session-/.test(id)).length,8);
  setup.view.dialogOpen=false;setup.click('plaza-zoom-in');setup.render();
  assert.equal(setup.view.floor.zoom,1.25);
  setup.click('plaza-zoom-reset');assert.equal(setup.view.floor.zoom,1);
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
