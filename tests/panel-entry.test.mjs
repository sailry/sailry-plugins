import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const settle=async()=>{for(let index=0;index<12;index++)await Promise.resolve();};
async function controller(name,file='main.js',globals={}) {
  const source=(await readFile(new URL(`../${name}/dev.sailry.platform/desktop/${file}`,import.meta.url),'utf8'))
    .replace(/^import[\s\S]*?;\n/gm,'').replace(/^export /gm,'').replace('default class','class');
  return vm.runInNewContext(`${source}\n${({gomoku:'Gomoku',reversi:'Reversi',xiangqi:'Xiangqi',poker:'Poker','liars-dice':'LiarsDice',doudizhu:'DouDizhu','city-trader':'CityTrader'})[name]}`,{
    View:class{},Motion:class{},sdkContext:()=>({execution_node:[1,...Array(31).fill(0)]}),context:()=>JSON.stringify({locale:'en'}),
    messages:()=>new Proxy({names:['First','Second','Third']},{get:(value,key)=>value[key]??key}),...globals,
  });
}
function changes() {
  let pending;
  return {read:()=>new Promise((resolve,reject)=>{pending={resolve,reject};}),
    async send(cursor,entry='0',connected=true){assert.ok(pending);pending.resolve({cursor,entry,connected});await settle();},
    async close(){pending.reject(new Error('View closed'));await settle();}};
}

for(const name of ['gomoku','reversi','xiangqi','poker','liars-dice','doudizhu','city-trader'])test(`${name}: entry refreshes the lobby without restarting a game or replaying an uncertain turn`,async()=>{
  const updates=changes(),jobs=[];
  const Controller=await controller(name,'main.js',{nextChange:updates.read});
  const owner=new Controller(),cx={notify(){},spawn:job=>jobs.push(job)};
  let reads=0;
  owner.configure=()=>{reads++;};owner.init(null,cx);
  const observation=jobs.at(-1)(cx);
  await updates.send('7:true:0');assert.equal(reads,1);
  await updates.send('8:true:0');assert.equal(reads,1);
  await updates.send('8:true:1','1');assert.equal(reads,2);
  const game={phase:'retained'};
  Object.assign(owner,{game,pending:'original-turn',error:'unconfirmed'});
  await updates.send('8:true:2','2');assert.equal(reads,2);
  assert.equal(owner.game,game);assert.equal(owner.pending,'original-turn');assert.equal(owner.error,'unconfirmed');
  owner.game=null;
  await updates.send('8:true:3','3');assert.equal(reads,2);
  owner.pending=null;owner.savePending='original-save';
  await updates.send('8:true:4','4');assert.equal(reads,2);
  owner.savePending=null;
  await updates.send('8:true:5','5');assert.equal(reads,3);
  await updates.send('8:false:5','5',false);
  await updates.send('8:true:5','5',true);assert.equal(reads,4);
  await updates.close();await observation;
});
