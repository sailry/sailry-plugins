import {integer,total,context,cost} from './format.js';

export const CATEGORIES = [
  ['system','context_system','chart_2'], ['tools','context_tools','chart_4'],
  ['user','context_user','chart_3'], ['skills','context_skills','chart_5'],
  ['injected','context_injected','chart_2'], ['assistant','context_assistant','chart_1'],
  ['results','context_results','chart_3'],
];
const sum = values => values.some(value=>value==null) ? null : values.reduce((value,item)=>value+integer(item),0n);
const difference = (left,right) => left==null || right==null || integer(left)<integer(right) ? null : integer(left)-integer(right);
const category = (values,kind) => values?.find(value=>value.kind===kind);
const rate = (tokens,time) => tokens==null || time==null || integer(time)<=0n ? null : Number(tokens)*1000000/Number(time);

export function categories(values) {
  return CATEGORIES.map(([kind,label,color])=>{
    const value=category(values,kind);
    return {kind,label,color,items:integer(value?.items),tokens:integer(value?.tokens),method:value?.method??null};
  });
}

/** Every bar is a retained real request, not interpolation between observations. */
export function history(statistics) {
  const recent=statistics?.observations?.recent??[];
  const count=integer(statistics?.observations?.calls)??BigInt(recent.length);
  const first=count>=BigInt(recent.length) ? count-BigInt(recent.length)+1n : 1n;
  return recent.map((request,index)=>{
    const attempt=request.attempts.at(-1),parts=categories(attempt?.categories);
    const measured=total(attempt?.usage);
    const estimate=parts.length && attempt?.complete_context ? sum(parts.map(part=>part.tokens)) : null;
    return {id:request.id,step:first+BigInt(index),model:request.model,limit:integer(request.context_limit),
      timestamp:request.timestamp_ms,attempt,parts,tokens:measured??estimate,estimated:measured==null,
      complete:attempt?.complete_context===true};
  });
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
  const snapshots=history(statistics),latest=snapshots.at(-1)??null;
  const chosen=snapshots.find(item=>item.id===selected)??latest;
  const used=current(state);
  const usage=statistics?.usage;
  const priced=statistics?.cost && integer(statistics.cost.responses)===integer(statistics.responses);
  const input=integer(usage?.input),output=integer(usage?.output);
  const cached=integer(observations?.cache_read),reasoning=integer(observations?.reasoning);
  const tools=Object.entries(observations?.tools??{}).map(([name,count])=>({name,count:integer(count)}))
    .sort((left,right)=>left.count===right.count ? left.name.localeCompare(right.name) : left.count>right.count ? -1 : 1);
  return {used,snapshots,chosen,latest,
    usage:{input,output,total:sum([input,output]),cached,reasoning,
      cache:input!=null && input>0n && cached!=null ? Number(cached)*100/Number(input) : null,
      cost:priced?cost(statistics):null,turns:integer(statistics?.turns),steps:integer(observations?.calls),
      replies:integer(observations?.replies),compactions:integer(observations?.compactions),tools,
      toolCount:observations ? sum(tools.map(tool=>tool.count)) : null,
      // Payload attribution counts repeated consumption, not unique executions.
      skills:null,injected:null,
      children:integer(observations?.children),delegated:total(statistics?.delegated?.tokens)},
    composition:composition(observations?.composition,reasoning,output),
    timing:timing(observations),connection:connection(state,latest)};
}

export function composition(values,reasoning,output) {
  const input=(...kinds)=>sum(kinds.map(kind=>category(values,kind)?.tokens));
  return [
    {kind:'dialogue',label:'context_dialogue',color:'chart_1',tokens:input('user','assistant'),estimated:true},
    {kind:'tools',label:'context_tool_content',color:'chart_3',tokens:input('tools','results'),estimated:true},
    {kind:'system',label:'context_system_skills',color:'chart_2',tokens:input('system','skills','injected'),estimated:true},
    {kind:'reasoning',label:'usage_column_reasoning',color:'chart_5',tokens:reasoning,estimated:false},
    {kind:'output',label:'context_reply',color:'chart_4',tokens:difference(output,reasoning),estimated:false},
  ];
}

export function timing(observations) {
  const phases=observations?.phases;
  const rows=[
    ['waiting','context_waiting','chart_1',phases?.waiting_us],
    ['thinking','context_thinking','chart_2',null],
    ['output','context_reply','chart_5',phases?.output_us],
    ['tools','context_tool_execution','chart_3',phases?.tools_us],
    ['arguments','context_tool_arguments','chart_4',null],
    ['other','context_other','muted_foreground',phases?.other_us],
  ].map(([id,label,color,value])=>({id,label,color,value:integer(value)}));
  return {active:integer(phases?.active_us),rows,
    speed:integer(observations?.output_samples)>0n ? rate(observations.output_tokens,observations.output_us) : null};
}

export function connection(state,latest) {
  const attempt=latest?.attempt;
  const elapsed=integer(attempt?.elapsed_us),first=integer(attempt?.first_text_us),headers=integer(attempt?.headers_us);
  const output=attempt?.reasoning_reported ? difference(attempt.usage?.output,attempt.usage?.reasoning) : null;
  return {headers,first,elapsed,waiting:difference(first,headers),speed:rate(output,difference(elapsed,first)),
    transport:attempt?.transport??null,status:attempt?.status??null,reused:attempt?.reused??null,
    outcome:attempt?.outcome??null,route:state.connection?.route??null,rtt:state.connection?.rtt_ms??null,
    // The observation contract does not measure handshake or latest-content time.
    handshake:null,freshness:null};
}
