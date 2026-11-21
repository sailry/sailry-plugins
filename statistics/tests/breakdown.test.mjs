import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {breakdown,annotated,VISIBLE,NAME_WIDTH} from '../dev.sailry.platform/desktop/breakdown.js';
import {compact,grouped} from '../dev.sailry.platform/desktop/format.js';
import {percent} from '../dev.sailry.platform/desktop/summary.js';
import {messages} from '../dev.sailry.platform/desktop/locales.js';

test('provider notes show only when every row fits its name and note',()=>{
  assert(annotated([{name:'gpt-5',note:'OpenAI'},{name:'Unassigned',note:null}]));
  assert(!annotated([{name:'gpt-5',note:'OpenAI'},{name:'a-model-name-far-too-long-for-the-column',note:'Provider'}]));
  assert(!annotated([{name:'通义千问旗舰版长上下文模型',note:'阿里云百炼平台'}]));
  assert(annotated([]));
});

const text={usage_unassigned:'Unassigned'};
const names={providers:new Map([['p1','Anthropic']]),projects:new Map([['proj','Web']])};
const metrics=(input,output,cached='0',cost)=>({responses:'2',tokens:{input,output,cached_input:cached,reasoning:'0'},...cost ? {cost} : {}});
const model=(provider,name,values,label)=>({key:{kind:'model',data:{provider,model:name}},metrics:values,...label ? {name:label} : {}});

test('models sort by tokens with provider notes and shares',()=>{
  const rows=breakdown([model('p1','small',metrics('10','10')),model('p2','big',metrics('60','20','30'),'OpenAI'),
    model('p1','none',{responses:'1',tokens:null})],'model',names,text);
  assert.deepEqual(rows.map(row=>row.name),['big','small','none']);
  assert.deepEqual(rows.map(row=>row.note),['OpenAI','Anthropic','Anthropic']);
  assert.equal(rows[0].total,80n);assert.equal(rows[0].share,80);assert.equal(rows[0].hit,50);
  assert.equal(rows[2].total,null);assert.equal(rows[2].share,null);assert.equal(rows[2].hit,null);
});

test('providers aggregate their models and mark partial costs',()=>{
  const rows=breakdown([model('p1','a',metrics('10','0','5',{usd_micros:'1000000',responses:'2'})),
    model('p1','b',metrics('30','0','0')),model('p2','c',metrics('1','0'))],'provider',names,text);
  assert.deepEqual(rows.map(row=>[row.id,row.name,row.total,row.responses]),[['p1','Anthropic',40n,4n],['p2','p2',1n,2n]]);
  assert.equal(rows[0].cost,'1.00+');assert.equal(rows[1].cost,null);
  assert.equal(rows[0].hit,12.5);
});

test('providers aggregate known tokens without inventing coverage',()=>{
  const rows=breakdown([
    model('p1','complete',metrics('5','8','1')),
    model('p1','partial',{responses:'3',tokens:null,token_subtotal:metrics('20','3','4').tokens,incomplete_token_responses:'2'}),
    model('p1','legacy',{responses:'1',tokens:null}),
    model('p2','complete',metrics('4','0','2')),
    model('p2','empty',{responses:'0',tokens:null}),
    model('p3','unknown',{responses:'2',tokens:null,incomplete_token_responses:'2'}),
  ],'provider',names,text);
  assert.deepEqual(rows.map(row=>[row.id,row.total,row.reported,row.responses,row.share,row.hit]),[
    ['p1',36n,3n,6n,90,null],['p2',4n,2n,2n,10,50],['p3',null,0n,2n,null,null],
  ]);
});

test('projects merge unowned conversations and ignore models',()=>{
  const rows=breakdown([{key:{kind:'project',data:'proj'},metrics:metrics('5','0')},
    {key:{kind:'session',data:'s1'},metrics:metrics('1','0')},{key:{kind:'session',data:'s2'},metrics:metrics('2','0')},
    {key:{kind:'connection',data:{id:'c'}},name:'Prod DB',metrics:metrics('4','0')},model('p1','a',metrics('9','0'))],'project',names,text);
  assert.deepEqual(rows.map(row=>[row.name,row.total]),[['Web',5n],['Prod DB',4n],['Unassigned',3n]]);
  assert.deepEqual(breakdown([{key:{kind:'project',data:'proj'},metrics:metrics('5','0')}],'model',names,text),[]);
});

test('merged unassigned rows show zero subtotals and exact coverage',async()=>{
  const source=(await readFile(new URL('../dev.sailry.platform/desktop/view.js',import.meta.url),'utf8'))
    .replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
  const element=new Proxy({},{get:()=>()=>element}), control=function(){return element;};
  let table;
  const {distribution}=vm.runInNewContext(`${source}\n({distribution})`,{
    div:()=>element,theme:()=>({colors:{muted_foreground:'muted'}}),Tab:control,TabBar:control,DIMENSIONS:['model','provider','project'],
    DataTable:{new:(_,props)=>{table=props;return element;}},breakdown,annotated,VISIBLE,NAME_WIDTH,compact,grouped,percent,
  });
  const view={state:{breakdown:'project',query:{dimension:'project'}},text:messages('en')};
  distribution(view,{query:{dimension:'project'},groups:[
    {node:'a',key:{kind:'project',data:'complete'},metrics:metrics('10','0')},
    {node:'a',key:{kind:'session',data:'measured'},metrics:metrics('0','0')},
    {node:'b',key:{kind:'session',data:'missing'},metrics:{responses:'3',tokens:null,incomplete_token_responses:'3'}},
    {node:'b',key:{kind:'project',data:'unknown'},metrics:{responses:'1',tokens:null,incomplete_token_responses:'1'}},
  ]});
  assert.equal(table.columns[1],'Share of subtotal');
  assert.equal(table.rows[0][2],'10');
  assert.equal(table.rows[1][1],'0.0%');
  assert.equal(table.rows[1][2],'Subtotal: 0');
  assert.equal(table.cells[1][2].primary.text,'Subtotal: 0');
  assert.equal(table.cells[1][2].primary.note,'2/5');
  assert.equal(table.details[1][2],'Subtotal: 0\n2 of 5 responses reported both token counts');
  assert.equal(table.cells[2][2].primary.text,'—');
  assert.equal(table.cells[2][2].primary.note,'0/1');
});

test('ties sort by name and the first rows stay visible',()=>{
  const groups=Array.from({length:VISIBLE+2},(_,index)=>model('p1',`m${index}`,metrics('1','0')));
  const rows=breakdown(groups.reverse(),'model',names,text);
  assert.equal(VISIBLE,6);
  assert.deepEqual(rows.slice(0,VISIBLE).map(row=>row.name),['m0','m1','m2','m3','m4','m5']);
});

test('same resource UUIDs stay separate across Nodes',()=>{
  const catalog={providers:new Map([['a:p','Laptop model'],['b:p','Host model']]),
    projects:new Map([['a:proj','Local project'],['b:proj','Remote project']]),hosts:new Map([['a','Laptop'],['b','Server']])};
  const groups=[{node:'a',...model('p','same',metrics('10','0'))},{node:'b',...model('p','same',metrics('20','0'))}];
  assert.deepEqual(breakdown(groups,'provider',catalog,text).map(row=>[row.id,row.name,row.total]),
    [['b:p','Host model',20n],['a:p','Laptop model',10n]]);
  assert.deepEqual(breakdown(groups,'model',catalog,text).map(row=>row.note),['Host model · Server','Laptop model · Laptop']);
  const projects=breakdown(['a','b'].map(node=>({node,key:{kind:'project',data:'proj'},metrics:metrics('1','0')})),'project',catalog,text);
  assert.deepEqual(projects.map(row=>row.id),['a:project:proj','b:project:proj']);
});
