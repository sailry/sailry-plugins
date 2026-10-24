import {integer,total,context,cost,speed} from './format.js';
import {SLOW_FIRST_TOKEN,SLOW_RESPONSE} from './requests.js';

export const CATEGORIES = [
  ['system','context_system','chart_4'], ['tools','context_tools','chart_1'],
  ['user','context_user','chart_3'], ['skills','context_skills','chart_5'],
  ['injected','context_injected','chart_4'], ['assistant','context_assistant','chart_2'],
  ['results','context_results','chart_3'],
];
const sum = values => values.some(value=>value==null) ? null : values.reduce((value,item)=>value+integer(item),0n);
const difference = (left,right) => left==null || right==null || integer(left)<integer(right) ? null : integer(left)-integer(right);
const category = (values,kind) => values?.find(value=>value.kind===kind);
const measured = value => {
  try { const number=integer(value); return number!=null && number>=0n ? number : null; }
  catch { return null; }
};

/** Known values may share an observed whole without inventing unknown categories. */
export function shares(parts,whole=null) {
  const measured=parts.filter(part=>part.value!=null);
  if(whole==null && measured.length!==parts.length)return [];
  const denominator=whole==null ? measured.reduce((sum,part)=>sum+Number(part.value),0) : Number(whole);
  if(!Number.isFinite(denominator) || denominator<=0)return [];
  return measured.filter(part=>Number(part.value)>0).map(part=>({...part,
    share:Math.min(100,Number(part.value)/denominator*100)}));
}

/** Response receipt over one second is slow; over three seconds is very slow. */
const RESPONSE_WARNING = 1000000n, RESPONSE_DANGER = 3000000n;
export function latency(value,phase='response') {
  value=measured(value);
  if(value==null)return 'muted_foreground';
  const warning=phase==='waiting'?SLOW_FIRST_TOKEN:RESPONSE_WARNING;
  const danger=phase==='waiting'?SLOW_RESPONSE:RESPONSE_DANGER;
  return value>=danger?'destructive':value>warning?'warning':'success';
}

export function categories(values) {
  return CATEGORIES.map(([kind,label,color])=>{
    const value=category(values,kind);
    return {kind,label,color,items:integer(value?.items),tokens:integer(value?.tokens),method:value?.method??null};
  });
}

function snapshot(request) {
  if(!request)return null;
  const attempt=request.attempts.at(-1),parts=categories(attempt?.categories);
  const reported=total(attempt?.usage);
  const estimate=attempt?.complete_context ? sum(parts.map(part=>part.tokens)) : null;
  return {id:request.turn,request:request.id,step:measured(request.turn_index),model:request.model,
    limit:integer(request.context_limit),timestamp:request.timestamp_ms,attempt,parts,
    tokens:reported??estimate,estimated:reported==null,complete:attempt?.complete_context===true};
}

/** Each task round retains its latest real request, never a sum of its requests. */
export function history(statistics) {
  const turns=new Map();
  for(const request of statistics?.observations?.recent??[]) {
    const value=snapshot(request);
    // Missing membership or round attribution cannot become an invented step.
    if(typeof value.id!=='string' || !value.id || value.step==null || value.step<1n)continue;
    turns.set(value.id,value);
  }
  return [...turns.values()].sort((left,right)=>left.step<right.step?-1:left.step>right.step?1:0);
}

/** Sum the plotted step snapshots without treating consumption as one window's occupancy. */
function aggregate(snapshots) {
  const parts=CATEGORIES.map(([kind,label,color])=>{
    const values=snapshots.map(item=>item.parts.find(part=>part.kind===kind));
    const methods=values.map(value=>value?.method??null);
    return {kind,label,color,items:values.length?sum(values.map(value=>value?.items)):null,
      tokens:values.length?sum(values.map(value=>value?.tokens)):null,
      method:methods.length && methods.every(value=>value===methods[0])?methods[0]:null};
  });
  return {parts,tokens:snapshots.length?sum(snapshots.map(item=>item.tokens)):null,
    estimated:snapshots.some(item=>item.estimated),complete:snapshots.length>0 && snapshots.every(item=>item.complete)};
}

/** Occupancy always retains the observation's model and window ownership. */
export function current(state) {
  const statistics=state.statistics;
  const changed=state.model!=null && statistics?.context_model!=null && state.model!==statistics.context_model;
  const tokens=changed?null:integer(statistics?.context_tokens??statistics?.context_estimate);
  const limit=integer(changed?state.context_limit:statistics?.context_limit??(tokens==null?state.context_limit:null)),budget=statistics?.budget;
  const model=changed?state.model:statistics?.context_model??state.model??null;
  const sameBudget=budget!=null && model===budget.model && limit===integer(budget.context_limit);
  return {tokens,limit,model,estimated:statistics?.context_tokens==null && tokens!=null,
    percent:context(tokens,limit),basis:tokens==null ? null : statistics?.context_tokens==null ? 'context_basis_estimate' : 'context_basis_observed',
    threshold:sameBudget ? integer(budget.trigger_tokens) : null,
    reserve:sameBudget ? integer(budget.output_reserve) : null};
}

/** Historical selection never changes current occupancy or the current connection. */
export function overview(state,selected) {
  const statistics=state.statistics, observations=statistics?.observations;
  const snapshots=history(statistics),latest=snapshot(observations?.recent?.at(-1));
  const chosen=snapshots.find(item=>item.id===selected)??null;
  const used=current(state);
  const usage=statistics?.usage;
  const priced=statistics?.cost && integer(statistics.cost.responses)===integer(statistics.responses);
  const input=integer(usage?.input),output=integer(usage?.output);
  const cached=integer(observations?.cache_read),reasoning=integer(observations?.reasoning);
  const tools=Object.entries(observations?.tools??{}).map(([name,count])=>({name,count:integer(count)}))
    .sort((left,right)=>left.count===right.count ? left.name.localeCompare(right.name) : left.count>right.count ? -1 : 1);
  return {used,snapshots:snapshots.map(item=>({...item,selected:item===chosen,
      color:chosen && item!==chosen?'muted_foreground':'chart_2'})),
    chosen,detail:chosen??aggregate(snapshots),latest,
    usage:{input,output,total:sum([input,output]),cached,reasoning,
      cache:input!=null && input>0n && cached!=null ? Number(cached)*100/Number(input) : null,
      cost:priced?cost(statistics):null,turns:integer(statistics?.turns),steps:integer(statistics?.turns),
      replies:integer(observations?.replies),compactions:integer(observations?.compactions),tools,
      toolCount:observations ? sum(tools.map(tool=>tool.count)) : null,
      // Payload attribution counts repeated consumption, not unique executions.
      skills:null,injected:null,
      children:integer(observations?.children),delegated:total(statistics?.delegated?.tokens)},
    composition:composition(observations?.composition,reasoning,output),
    timing:timing(observations,statistics?.generation),connection:connection(state,latest)};
}

export function composition(values,reasoning,output) {
  const input=(...kinds)=>sum(kinds.map(kind=>category(values,kind)?.tokens));
  return [
    {kind:'dialogue',label:'context_dialogue',color:'chart_2',tokens:input('user','assistant'),estimated:true},
    {kind:'tools',label:'context_tool_content',color:'chart_3',tokens:input('tools','results'),estimated:true},
    {kind:'system',label:'context_system_skills',color:'chart_4',tokens:input('system','skills','injected'),estimated:true},
    {kind:'reasoning',label:'usage_column_reasoning',color:'chart_5',tokens:reasoning,estimated:false},
    {kind:'output',label:'context_reply',color:'chart_1',tokens:difference(output,reasoning),estimated:false},
  ];
}

export function timing(observations,generation=null) {
  const phases=observations?.phases;
  const rows=[
    ['waiting','context_waiting','chart_2',phases?.waiting_us],
    ['thinking','context_thinking','chart_4',null],
    ['output','context_reply','chart_5',phases?.output_us],
    ['tools','context_tool_execution','chart_3',phases?.tools_us],
    ['arguments','context_tool_arguments','chart_1',null],
    ['other','context_other','muted_foreground',phases?.other_us],
  ].map(([id,label,color,value])=>({id,label,color,value:integer(value)}));
  return {active:integer(phases?.active_us),rows,speed:speed(generation)};
}

export function connection(state,latest) {
  const attempt=latest?.attempt,latency=state.statistics?.observations?.latency;
  return {headers:measured(attempt?.headers_us),response:measured(latency?.response_us),
    first:measured(latency?.first_text_us),elapsed:measured(latency?.elapsed_us),waiting:measured(latency?.waiting_us),
    speed:speed(state.statistics?.generation),
    transport:attempt?.transport??null,status:attempt?.status??null,reused:attempt?.reused??null,
    outcome:attempt?.outcome??null,route:state.connection?.route??null,rtt:state.connection?.rtt_ms??null,
    // The observation contract does not measure handshake or latest-content time.
    handshake:null,freshness:null};
}
