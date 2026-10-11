import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const plain=value=>JSON.parse(JSON.stringify(value));
async function fixture() {
  let state;
  const context=vm.createContext({});
  const sdk=new vm.SyntheticModule(['stageTurnState','readTurnState'],function(){this.setExport('stageTurnState',value=>state=plain(value));this.setExport('readTurnState',()=>plain(state));},{context});
  const modules=new Map([['sailry/sdk',sdk]]);
  async function load(name) {
    if(modules.has(name))return modules.get(name);
    const source=await readFile(new URL(`../dev.sailry.platform/host/${name}`,import.meta.url),'utf8');
    const module=new vm.SourceTextModule(source,{context,identifier:name});modules.set(name,module);await module.link(load);return module;
  }
  const main=await load('./main.js');await main.evaluate();return main.namespace;
}
const tools=['ssh_run','ssh_transfer'];
const connections={bound:{kind:'ssh',id:'a'},databases:[],ssh:[{id:'a',name:'Work host'}]};
const created='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const management=['ssh_connections','ssh_save_connection'];

test('binds the saved target and package workspace guidance',async()=>{
  const api=await fixture();
  const result=api.initialize({tools,resources:true,connections});
  assert.equal(result.parameters.ssh_run.properties.connection.enum,undefined);
  assert.match(created,new RegExp(result.parameters.ssh_run.properties.connection.pattern));
  assert.equal(result.parameters.ssh_run.properties.connection.description,'[["a","Work host"]]');
  assert.equal(result.instruction,'');
  const manifest=JSON.parse(await readFile(new URL('../plugin.json',import.meta.url),'utf8'));
  assert.ok(manifest.extensions['dev.sailry.platform'].desktop.conversations[0].context.includes('SSH workspace assistant'));
  assert.equal(api.initialize({tools,resources:false,connections}).instruction,'');
  assert.equal(api.initialize({tools,resources:true,connections:{...connections,bound:null}}).instruction,'');
});

test('keeps command text, enforces target and timeout, and never accepts caller credentials',async()=>{
  const api=await fixture();api.initialize({tools,resources:true,connections});
  const command='printf "资料 🙂\\n"';
  assert.deepEqual(plain(api.run({connection:'a',command})),{connection:'a',command,timeout_ms:120000});
  assert.equal(api.run({connection:'a',command,timeout_ms:900000}).timeout_ms,900000);
  for(const args of [{connection:'b',command},{connection:'a',command,timeout_ms:0},{connection:'a',command,timeout_ms:900001},{connection:'a',command,password:'hidden'}]) assert.equal(api.run(args).isError,true);
});

test('prepares only explicit upload or download while preserving both path domains',async()=>{
  const api=await fixture();api.initialize({tools,resources:true,connections});
  const input={connection:'a',path:'local/资料.txt',remote_path:'/srv/资料.txt',direction:'upload'};
  assert.deepEqual(plain(api.transfer(input)),{...input,timeout_ms:120000});
  assert.equal(api.transfer({...input,direction:'other'}).isError,true);
  assert.equal(api.transfer({...input,worktree:'caller-selected'}).isError,true);
  assert.deepEqual(plain(api.initialize({tools,resources:true,connections:{...connections,ssh:[]}}).tools),tools);
});

test('connection tools expose no secret or trust inputs',async()=>{
  const api=await fixture();
  const all=[...tools,...management];
  const initialized=api.initialize({tools:all,connections:{ssh:[],databases:[]}});
  assert.deepEqual(plain(initialized.tools),all);
  assert.deepEqual(plain(api.connections({})),{});
  for(const args of [null,[],{host:'example.com'},{password:'hidden'}]) assert.equal(api.connections(args).isError,true);
  const schema=initialized.parameters.ssh_save_connection;
  assert.equal(schema.additionalProperties,false);
  assert.deepEqual(plain(schema.properties.authentication.enum),['agent','key_path']);
  for(const key of ['password','key','passphrase','host_key','sharing']) assert.equal(schema.properties[key],undefined);
  assert.deepEqual(plain(schema.allOf[0].then.required),['expected_revision']);
  const manifest=JSON.parse(await readFile(new URL('../plugin.json',import.meta.url),'utf8'));
  const extension=manifest.extensions['dev.sailry.platform'];
  for(const name of management) {
    const tool=extension.tools.find(tool=>tool.name===name);
    assert.equal(tool.handler.operation,name==='ssh_connections'?'ssh.connections':'ssh.save');
    assert.equal(tool.handler.result,name==='ssh_save_connection'?'saved':undefined);
    assert.deepEqual(tool.handler.parameters,plain(initialized.parameters[name]));
    assert.ok(extension.desktop.conversations[0].tools.some(tool=>tool.name===name));
  }
  assert.match(extension.instructions,/user must confirm the exact first host fingerprint/);
});

test('save supports agent and key paths without altering update credentials',async()=>{
  const api=await fixture();api.initialize({tools:management,connections:{ssh:[{id:created,name:'Work host'}],databases:[]}});
  const agent={name:'Work host',host:'ssh.example',port:22,username:'user',authentication:'agent'};
  assert.deepEqual(plain(api.save(agent)),agent);
  assert.deepEqual(plain(api.save({...agent,connection:null,expected_revision:null})),agent);
  const key={...agent,authentication:'key_path',key_path:'/keys/id_ed25519'};
  assert.deepEqual(plain(api.save(key)),key);
  const update={connection:created,expected_revision:3,name:'Renamed'};
  assert.deepEqual(plain(api.save(update)),update);
  assert.deepEqual(plain(api.save({...update,authentication:'key_path'})),{...update,authentication:'key_path'});
  for(const args of [null,[],{}, {...agent,port:0}, {...agent,port:65536}, {...agent,port:1.5},
    {...agent,username:null}, {...agent,authentication:'password'}, {...agent,key_path:'/keys/key'},
    {...key,key_path:null}, {...key,key_path:''}, {connection:created}, {expected_revision:1},
    {connection:created,expected_revision:null}, {connection:other,expected_revision:1},
    {connection:created,expected_revision:0}, {...update,name:null},
    ...['password','key','passphrase','host_key','sharing'].map(key=>({...agent,[key]:'hidden'}))]) {
    assert.equal(api.save(args).error.code,'invalid_request');
  }
});

test('only successful save results enable same-turn SSH calls',async()=>{
  const api=await fixture();api.initialize({tools:[...tools,...management],connections:{ssh:[],databases:[]}});
  const args={name:'Work host',host:'ssh.example',port:22,username:'user',authentication:'agent'};
  const run={connection:created,command:'uname -a'};
  assert.equal(api.run(run).isError,true);
  for(const output of [{isError:true,error:{code:'denied',message:'Denied'}},
    {kind:'ssh_profiles',data:[{id:created}]}, {kind:'ssh_profile',data:{id:'invalid'}},
    {kind:'ssh_profile',data:{id:created},error:{code:'outcome_unknown'}}]) {
    assert.equal(api.saved({arguments:args,output}),output);
    assert.equal(api.run(run).isError,true);
  }
  const output={kind:'ssh_profile',data:{id:created,revision:1,authentication:{kind:'agent'}}};
  assert.equal(api.saved({arguments:args,output}),output);
  assert.equal(api.saved({arguments:args,output}),output);
  assert.deepEqual(plain(api.run(run)),{...run,timeout_ms:120000});
  api.saved({arguments:{connection:created,expected_revision:1},output:{kind:'ssh_profile',data:{id:other}}});
  assert.equal(api.run({...run,connection:other}).isError,true);
  assert.deepEqual(plain(api.transfer({connection:created,path:'local.txt',remote_path:'/tmp/remote.txt',direction:'upload'})),
    {connection:created,path:'local.txt',remote_path:'/tmp/remote.txt',direction:'upload',timeout_ms:120000});
});
