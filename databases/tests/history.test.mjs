import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {updates,result} from '../dev.sailry.platform/desktop/history.js';
test('distinguishes restored results from new canonical responses and preserves exact cells',()=>{
  const call={key:'turn:call',name:'database_query',arguments:{connection:'original',sql:'SELECT id'},state:'returned',sequence:'9007199254740993',result:{kind:'database_outcome',data:{kind:'query',data:{columns:['id'],rows:[[{kind:'integer',value:'9223372036854775807'}]],affected_rows:'0',truncated:false}}}};
  const snapshot={connected:true,session:'session',revision:'4',latest:call.sequence,calls:[call]};
  assert.equal(updates(snapshot,null)[0].live,false);
  const before={connected:true,session:'session',revision:'4',latest:'9007199254740992',calls:[]};
  assert.equal(updates(snapshot,before)[0].live,true);
  assert.equal(updates(snapshot,{...before,revision:'3'})[0].live,false);
  assert.deepEqual(updates(snapshot,snapshot),[]);
  assert.equal(result(call).rows.rows[0][0].value,'9223372036854775807');
  assert.deepEqual(result({...call,result:{error:{code:'permission_denied',message:'Denied'}}}),{error:{code:'permission_denied',message:'Denied'}});
  assert.deepEqual(result({...call,result:null,state:'interrupted'}),{error:{code:'cancelled'}});
});


test('navigation preserves newest-first arrows and selected copy or open',async()=>{
  const source=(await readFile(new URL('../dev.sailry.platform/desktop/main.js',import.meta.url),'utf8'))
    .replace(/^import[\s\S]*?;\n/gm,'').replace('export default class','class').replace(/^export /gm,'');
  const copied=[],opened=[];
  const Controller=vm.runInNewContext(`${source}\nDatabases`,{View:class{},writeClipboard:text=>copied.push(text)}),owner=new Controller();
  let focused=0,stopped=0,notified=0;
  const cx={notify(){notified++;},stop_propagation(){stopped++;}};
  Object.assign(owner,{sqlOpen:false,logs:[{id:'older',sql:'SELECT older',database:'first'},{id:'newer',sql:'SELECT newer',database:'second'}],selectedLog:null,logFocus:{focus(){focused++;}}});
  owner.openSql=(sql,database,context)=>opened.push([sql,database,context]);
  const key=(key,modifiers={})=>owner.logKey({key,modifiers},cx);
  key('down');assert.equal(owner.selectedLog,'newer');
  key('up');assert.equal(owner.selectedLog,'newer');
  key('down');assert.equal(owner.selectedLog,'older');
  key('down');assert.equal(owner.selectedLog,'older');
  key('up');assert.equal(owner.selectedLog,'newer');
  key('c',{platform:true});assert.deepEqual(copied,['SELECT newer']);
  key('enter');assert.deepEqual(opened,[['SELECT newer','second',cx]]);
  owner.selectLog('older',cx);assert.equal(owner.selectedLog,'older');assert.equal(focused,1);
  owner.selectLog('missing',cx);assert.equal(owner.selectedLog,'older');assert.equal(focused,1);
  // The SQL dialog over the page takes the keys.
  owner.sqlOpen=true;key('up');assert.equal(owner.selectedLog,'older');
  assert.equal(stopped,7);assert.equal(notified,6);
});

test('new query opens the SQL dialog over its draft and a query that succeeds closes it',async()=>{
  const source=(await readFile(new URL('../dev.sailry.platform/desktop/main.js',import.meta.url),'utf8'))
    .replace(/^import[\s\S]*?;\n/gm,'').replace('export default class','class').replace(/^export /gm,'');
  const set=[];
  const Controller=vm.runInNewContext(`${source}\nDatabases`,{View:class{},setText:(_,text)=>set.push(text),focusText(){},readText:()=>'SELECT 1'}),owner=new Controller();
  const cx={notify(){}};
  Object.assign(owner,{connected:true,pending:null,sqlOpen:false,dialog:0,opened:'first',profiles:[{id:'first',revision:1,read_only:true}],catalog:{database:'main'}});
  owner.control({id:'db-new-query'},cx);
  assert.equal(owner.sqlOpen,true);assert.equal(owner.dialog,1);assert.deepEqual(set,[],'a new query keeps the last draft');
  owner.openSql('SELECT 2','other',cx);
  assert.equal(owner.dialog,1,'an open dialog takes new text in place');assert.deepEqual(set,['SELECT 2']);assert.equal(owner.catalog.database,'other');
  let after=null;
  owner.execute=(value,_cx,origin,then)=>{assert.equal(value.data.sql,'SELECT 1');after=then;};
  owner.run=action=>action(cx);
  owner.runSql(cx);
  assert.equal(owner.sqlOpen,true,'the dialog stays open while its query runs');
  after();assert.equal(owner.sqlOpen,false);
  owner.control({id:'db-new-query'},cx);owner.close(cx);assert.equal(owner.sqlOpen,false);
});
