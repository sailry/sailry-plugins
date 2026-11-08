import {byteLength} from './policy.js';

const maxChoices=256,maxStateBytes=64*1024;

function navigation(value) { return value ? {...value,locales:value.locales ?? {}} : null; }
function choice(value) {
  return {id:value.id,label:navigation(value.label),enabled:value.enabled,
    description:navigation(value.description),icon:value.icon ?? null,group:navigation(value.group)};
}
function state(value) {
  return {id:value.id,label:navigation(value.label),icon:value.icon ?? null,dropdown:false,
    visible:value.visible ?? true,enabled:value.enabled,loading:false,value:value.value ?? null,
    choices:value.choices?.map(choice) ?? null,details:[],segments:[],reply_to:value.reply_to ?? null};
}
function size(value) { return byteLength(JSON.stringify(value)); }
function resource(value) { return value.id.startsWith('project:') || value.id.startsWith('worktree:'); }

export function fit(states,text) {
  const location=states.find(state=>state.id==='location');
  if (!location) return states;
  const choices=location.choices;
  const base=size(states.map(value=>state(value===location ? {...value,choices:[]} : value)));
  const sizes=new Map(choices.map(value=>[value.id,size(choice(value))]));
  const total=base+[...sizes.values()].reduce((sum,bytes)=>sum+bytes,0)+Math.max(0,choices.length-1);
  if (choices.length<=maxChoices && total<=maxStateBytes) return states;
  if (!choices.some(value=>value.id==='projects') && choices.some(value=>value.id==='add_project')) {
    const picker={id:'projects',label:{label:text('location_project')},icon:'folder',
      group:{label:text('workspace_session_actions')},enabled:true};
    choices.splice(choices.findIndex(value=>value.id==='add_project'),0,picker);
    sizes.set(picker.id,size(choice(picker)));
  }
  const retained=new Set(choices.filter(value=>!resource(value) || value.id===location.value).map(value=>value.id));
  let bytes=base+[...retained].reduce((sum,id)=>sum+sizes.get(id),0)+Math.max(0,retained.size-1);
  for (const value of choices) {
    if (retained.has(value.id)) continue;
    const added=sizes.get(value.id)+(retained.size ? 1 : 0);
    if (retained.size>=maxChoices || bytes+added>maxStateBytes) continue;
    retained.add(value.id);bytes+=added;
  }
  location.choices=choices.filter(value=>retained.has(value.id));
  return states;
}
