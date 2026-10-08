import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createHash} from 'node:crypto';

export const plain = value => JSON.parse(JSON.stringify(value));
export const uuid = value => `00000000-0000-4000-8000-${value.toString().padStart(12,'0')}`;
export const file = (path, options = {}) => ({path,revision:createHash('sha256').update(`revision:${path}:1`).digest('hex'),
  metadata_revision:createHash('sha256').update(`metadata:${path}:1`).digest('hex'),
  first_line:'export function changed() {}',lines:[{kind:'added',old_line:null,new_line:7,text:'return changed();'}],...options});

export async function fixture(files = [file('src/main.js')], options = {}) {
  const worktree = uuid(2);
  const captured = {session:uuid(1),worktree,turn:uuid(3),package:{name:'code-review',digest:'digest-a',settings_revision:'0'}};
  const sessions = new Map([[captured.session,{id:captured.session,worktree:captured.worktree}]]);
  const values = new Map(), calls = [], requests = new Map();
  let sequence = 10, currentCall = uuid(sequence), metadata = 'inventory:1';
  let data = files.map(plain), head = 'a'.repeat(40);
  const committed = new Map();
  const scoped = snapshot => snapshot.target.kind === 'worktree' ? data : committed.get(JSON.stringify(snapshot.target));
  function fail(message, code = 'invalid_request') { return {Err:{code,message}}; }
  function native(command) {
    const args = command.data;
    if (command.kind === 'list_git_changes') {
      let snapshot = args.cursor?.snapshot;
      if (!snapshot) {
        const target = args.target;
        const resolved = target.kind === 'worktree' ? {kind:'worktree',data:{scope:target.data.scope,head,index_revision:'index:1'}}
          : target.kind === 'commit' ? {kind:'commit',data:{revision:head,parent:null}}
          : {kind:'range',data:{base:target.data.base,head}};
        snapshot = {target:resolved,metadata_revision:metadata};
        if (target.kind !== 'worktree') committed.set(JSON.stringify(resolved),data.map(plain));
      } else if (snapshot.target.kind === 'worktree' && (snapshot.metadata_revision !== metadata || snapshot.target.data.head !== head)) {
        return fail('Inventory changed','revision_conflict');
      }
      const inventory = scoped(snapshot);
      const all = inventory.map(value => ({path:value.path,old_path:value.old_path ?? null,kind:value.kind ?? 'modified',
        old_mode:33188,new_mode:33188,metadata_revision:value.metadata_revision})).sort((left,right) => left.path.localeCompare(right.path));
      const offset = args.cursor?.after_path == null ? 0 : all.findIndex(file => file.path === args.cursor.after_path)+1;
      const entries = all.slice(offset,offset+args.limit);
      const exhausted = offset+entries.length === all.length;
      return {Ok:{kind:'git_changes',data:{snapshot,entries,next:exhausted ? null : {snapshot,after_path:entries.at(-1).path},
        exhausted:options.incomplete ? false : exhausted,omitted_paths:options.incomplete ? 1 : 0}}};
    }
    if (command.kind !== 'read_git_change') throw new Error('Unexpected or mutating SDK command');
    if (args.snapshot.target.kind === 'worktree' && args.snapshot.metadata_revision !== metadata) return fail('Inventory changed','revision_conflict');
    const source = scoped(args.snapshot).find(file => file.path === args.path);
    if (!source) return fail('File absent','not_found');
    if (source.metadata_revision !== args.expected_metadata_revision || (args.expected_revision != null && args.expected_revision !== source.revision)) {
      return fail('File changed','revision_conflict');
    }
    const skipped = source.binary || source.skip_reason;
    const lines = skipped ? [] : source.lines.slice(args.offset,args.offset+args.limit);
    const next = skipped || args.offset+lines.length === source.lines.length ? null : args.offset+lines.length;
    return {Ok:{kind:'git_change',data:{snapshot:args.snapshot,path:source.path,old_path:source.old_path ?? null,
      metadata_revision:source.metadata_revision,revision:source.revision,offset:args.offset,next,lines,
      binary:source.binary ?? false,skip_reason:source.skip_reason ?? null,first_line:skipped ? null : source.first_line}}};
  }
  const sdk = {
    context:() => plain(captured), callId:() => currentCall,
    readSession:async () => plain(sessions.get(captured.session)),
    getValue:async key => plain(values.get(key) ?? {key,revision:'0',value:null,present:false}),
    prepareRequest:command => { calls.push(plain(command)); const id = `request-${requests.size}`; requests.set(id,plain(command)); return id; },
    completeRequest:async id => plain(native(requests.get(id))),
    forgetRequest:id => requests.delete(id),
  };
  const context = vm.createContext({console});
  const cache = new Map();
  const sdkModule = new vm.SyntheticModule(Object.keys(sdk),function () {
    for (const [name,handler] of Object.entries(sdk)) this.setExport(name,handler);
  },{context});
  async function load(url) {
    if (cache.has(url.href)) return cache.get(url.href);
    const pending = readFile(url,'utf8').then(source => new vm.SourceTextModule(source,{context,identifier:url.href}));
    cache.set(url.href,pending);
    return pending;
  }
  const entry = await load(new URL('../dev.sailry.platform/host/main.js',import.meta.url));
  await entry.link((name,parent) => name === 'sailry/sdk' ? sdkModule : load(new URL(name,parent.identifier)));
  await entry.evaluate();
  async function start(name,args) {
    currentCall = uuid(++sequence);
    const response = await entry.namespace[name]({arguments:plain(args),step:0,state:null,outcome:null});
    return {name,args:plain(args),response:plain(response)};
  }
  function commit(operations) {
    for (const operation of operations) {
      const {key,expected_revision} = operation.data;
      if ((values.get(key)?.revision ?? '0') !== expected_revision) return {isError:true,error:{code:'revision_conflict',message:'Revision conflict'}};
    }
    const output = [];
    for (const operation of operations) {
      if (operation.kind !== 'write') throw new Error('Unexpected transaction operation');
      const {key,value,expected_revision} = operation.data;
      const stored = {key,value:plain(value),revision:(BigInt(expected_revision)+1n).toString(),present:true};
      values.set(key,stored);
      output.push({kind:'plugin_value',data:plain(stored)});
    }
    return {kind:'plugin_transaction',data:output};
  }
  async function finish(pending, forced = null) {
    if (pending.response.result) return pending.response.result;
    const outcome = forced ?? commit(pending.response.call.arguments.operations);
    const response = await entry.namespace[pending.name]({arguments:pending.args,step:1,state:pending.response.state,outcome});
    return plain(response.result);
  }
  return {values,calls,captured,sessions,start,finish,commit,
    invoke:async (name,args) => finish(await start(name,args)),
    actor(id,parent = null,scope = worktree) {
      captured.session = id;
      captured.worktree = scope;
      sessions.set(id,{id,worktree:scope,delegation:parent ? {session:parent} : undefined});
    },
    change(path,updates) { Object.assign(data.find(file => file.path === path),updates); },
    metadata(value) { metadata = value; },
    head(value) { head = value; },
    async module(name) {
      const module = await load(new URL(`../dev.sailry.platform/host/${name}.js`,import.meta.url));
      if (module.status === 'linked') await module.evaluate();
      return module.namespace;
    },
  };
}
export function finding(scope, overrides = {}) {
  const source = scope.files[0];
  return {review_id:scope.review_id,path:source.path,revision:source.revision,side:'new',line:7,
    snippet:'return changed();',severity:'P1',title:'Changed result is lost',
    explanation:'The changed path loses its result when this branch runs.',evidence:'The added return and existing caller establish the failure.',...overrides};
}
export function receipt(scope, overrides = {}) {
  return {review_id:scope.review_id,reviewed_files:scope.files.map(({path,revision}) => ({path,revision})),
    reviewed_groups:scope.groups.map(({id}) => id),finalize:true,...overrides};
}
