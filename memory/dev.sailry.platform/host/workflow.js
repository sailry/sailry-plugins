import {readTurnState,stageTurnState,newId,isValueConflict} from 'sailry/sdk';
import {readMemorySettings} from './settings.js';
import {readMemory,head,unchanged,stable,snapshotChanged} from './storage.js';
import {putOperations,removeOperations,mergeOperations,memoryOutput,RecordChanged,EquivalentMemory} from './mutations.js';
import {argumentsFor,requireRead,retrieve,fail} from './policy.js';

export async function enabled(write) {
  const state=readTurnState(), current=await readMemorySettings();
  if (!state.settings.enabled || !current.enabled || (write && (!state.settings.auto_write || !current.auto_write))) fail('memory access is disabled','permission_denied');
  return state;
}
export function result({output}) {
  if (output.isError) return output;
  const outcome=memoryOutput(output);
  return outcome.kind==='memory_removed' ? {removed:outcome.data} : {updated:outcome.data};
}
async function latest(ids,turn) {
  const captured=await stable(async()=>{
    const current=await head(), entries=[], deleted=[];
    for (const id of new Set(ids)) {
      try { entries.push(await readMemory(id,turn.project)); }
      catch (error) { if (error.code!=='not_found') throw error; deleted.push(id); }
    }
    await unchanged(current.record.revision);
    return {entries,deleted};
  });
  const output={status:captured.entries.length ? 'changed' : 'deleted',saved:false,
    latest:retrieve(captured.entries,turn),deleted:captured.deleted};
  stageTurnState(turn);
  return output;
}
const finish=(value,failed)=>({result:failed ? {context:value} : value});
function writer(prepare) {
  return async ({arguments:input,step,state,outcome})=>{
    const retry=step>0 && isValueConflict(outcome);
    if (step>0 && !retry) return {result:result({output:outcome}),output:step-1};
    try {
      const turn=await enabled(true);
      if (step===8) return finish({status:'pending',saved:false},retry);
      try {
        const prepared=await prepare(input,turn,state);
        if (prepared.done) return finish(prepared.done,retry);
        return {call:{operation:'storage.transaction',arguments:prepared.arguments},state:prepared.state};
      } catch (error) {
        if (error instanceof RecordChanged || error instanceof EquivalentMemory) return finish(await latest(error.ids,turn),retry);
        throw error;
      }
    } catch (error) {
      if (snapshotChanged(error)) return finish({status:'pending',saved:false},retry);
      return {result:{isError:true,error:{code:error.code ?? 'internal',message:error.message}}};
    }
  };
}
export const save=writer(async(input,turn,state)=>{
  const value=argumentsFor(input,['id','expected_revision','global','archived','kind','title','body'],['expected_revision','kind','title','body']);
  let project=value.global ? null : turn.project;
  if (value.id!=null) {
    requireRead(turn,value.id,value.expected_revision);
    let current;
    try { current=await readMemory(value.id,turn.project); }
    catch (error) { if (error.code==='not_found') throw new RecordChanged([value.id]); throw error; }
    if (current.summary.revision!==value.expected_revision) throw new RecordChanged([value.id]);
    project=current.summary.project;
  }
  if (project===null && ((!value.global && value.id==null) || !['user','feedback'].includes(value.kind))) fail('global memory requires an explicit cross-project preference or correction; project facts require a project');
  const id=value.id ?? state?.id ?? newId();
  const arguments_=await putOperations({summary:{id,project,title:value.title,kind:value.kind,revision:value.expected_revision,updated_at_ms:0,archived:value.archived ?? false},body:value.body},value.expected_revision,turn.project);
  return {arguments:arguments_,state:{id}};
});
export const forget=writer(async(input,turn)=>{
  const value=argumentsFor(input,['id','expected_revision'],['id','expected_revision']);
  // Deletion retains its exact target, including if another writer changed its body.
  for (let attempt=0; ; attempt++) {
    try {
      const current=await readMemory(value.id,turn.project);
      return {arguments:await removeOperations(value.id,current.summary.revision,turn.project)};
    } catch (error) {
      if (error.code==='not_found') return {done:{status:'deleted',saved:false,deleted:[value.id]}};
      if (!(error instanceof RecordChanged) || attempt===2) throw error;
    }
  }
});
export const consolidate=writer(async(input,turn)=>{
  const value=argumentsFor(input,['id','expected_revision','title','body','sources'],['id','expected_revision','title','body','sources']);
  if (!Array.isArray(value.sources) || value.sources.length<1) fail('invalid consolidation arguments');
  const expected=[{id:value.id,revision:value.expected_revision},...value.sources];
  for (const source of expected) {
    if (!source || Object.keys(source).some(key=>!['id','revision'].includes(key)) || typeof source.id!=='string' || !Number.isSafeInteger(source.revision) || source.revision<1) fail('invalid consolidation arguments');
    requireRead(turn,source.id,source.revision);
  }
  const current=[];
  for (const source of expected) {
    try { current.push(await readMemory(source.id,turn.project)); }
    catch (error) { if (error.code==='not_found') throw new RecordChanged(expected.map(value=>value.id)); throw error; }
  }
  if (current.some((entry,index)=>entry.summary.revision!==expected[index].revision || entry.summary.archived)) throw new RecordChanged(expected.map(value=>value.id));
  const entry=current[0]; entry.summary.title=value.title; entry.body=value.body;
  try { return {arguments:await mergeOperations(entry,value.sources,turn.project)}; }
  catch (error) { if (error instanceof RecordChanged) throw new RecordChanged(expected.map(value=>value.id)); throw error; }
});
