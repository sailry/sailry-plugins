import {compact,price,integer,duration,ratio} from './format.js';

/** Cache hit rates below this percentage are highlighted. */
export const LOW_CACHE = 50;
/** First text later than this many microseconds is highlighted. */
export const SLOW_FIRST_TOKEN = 10000000n;
/** Responses taking at least this many microseconds are highlighted. */
export const SLOW_RESPONSE = 15000000n;
export const WARNING_ICON = 'reicon:ui/alert-triangle';

const pad=(value,width=2)=>String(value).padStart(width,'0');
const sameDay=(left,right)=>left.getFullYear()===right.getFullYear()&&left.getMonth()===right.getMonth()&&left.getDate()===right.getDate();
/** Local time for a request row: time only today, month and day otherwise. */
export function when(value,now = Date.now()) {
  const date=new Date(Number(value));
  if(!Number.isFinite(date.getTime()))return null;
  const time=`${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  return sameDay(date,new Date(now)) ? time : `${pad(date.getMonth()+1)}/${pad(date.getDate())} ${time}`;
}
function exactTime(value) {
  const date=new Date(Number(value));
  if(!Number.isFinite(date.getTime()))return null;
  const offset=-date.getTimezoneOffset(),zone=`${offset<0?'-':'+'}${pad(Math.floor(Math.abs(offset)/60))}:${pad(Math.abs(offset)%60)}`;
  return `${date.getFullYear()}/${pad(date.getMonth()+1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(),3)} ${zone}`;
}
/** Whole-percent cache hit rate for one response, or null without input. */
export function hits(tokens) {
  if(tokens?.input==null || tokens.cached_input==null)return null;
  const input=integer(tokens.input),cached=integer(tokens.cached_input);
  const value=ratio(cached<input?cached:input,input);
  return value==null ? null : Math.floor(value);
}
export const lateStart=value=>value!=null && integer(value)>SLOW_FIRST_TOKEN;
export const longResponse=value=>value!=null && integer(value)>=SLOW_RESPONSE;

/** Provider type logo on the badge surface, or the provider's initial when its type has no logo. */
export function mark(icon,name) {
  return icon ? {badge_icon:icon} : {badge:Array.from(name||'?')[0].toUpperCase()};
}

/** Table rows; `icons` maps provider IDs to type logos. */
export function formatRows(items,text,now = Date.now(),icons = new Map()) {
  const unknown=text.composer_metric_unknown;
  const exact=value=>value==null?unknown:String(value);
  const missing={text:unknown,text_tone:'muted'};
  const rows=[],cells=[],details=[],row_ids=[];
  for(const request of items) {
    const tokens=request.tokens ?? {},rate=hits(tokens),low=rate!=null&&rate<LOW_CACHE;
    const title=request.session_title||text.usage_untitled,scope=request.scope_name||text.usage_unassigned;
    const time=when(request.position.timestamp_ms,now)??unknown,full=exactTime(request.position.timestamp_ms)??unknown;
    const first=request.first_token_us,elapsed=request.elapsed_us;
    const micros=integer(request.usd_micros),cost=micros==null?unknown:`${micros/1000000n}.${String(micros%1000000n).padStart(6,'0')}`;
    const timing=[first,elapsed].map(value=>value==null?unknown:text.usage_duration_us.replace('%{value}',value));
    rows.push([full,`${title} · ${scope}`,`${request.model} · ${request.provider_name}`,
      exact(tokens.input),rate==null?unknown:`${rate}%`,exact(tokens.output),timing[0],timing[1],cost]);
    details.push([full,`${title}\n${scope}`,
      `${text.usage_column_model}: ${request.model}\n${text.usage_column_provider}: ${request.provider_name}`,
      `${text.usage_column_input}: ${exact(tokens.input)}`,`${text.usage_column_cached}: ${exact(tokens.cached_input)}`,
      `${text.usage_column_output}: ${exact(tokens.output)}\n${text.usage_column_reasoning}: ${exact(tokens.reasoning)}`,
      `${text.usage_column_first_token}: ${timing[0]}`,`${text.usage_column_duration}: ${timing[1]}`,cost]);
    cells.push([
      {primary:{text:time,text_tone:'muted'}},
      {primary:{text:title,chip:scope,...request.session_title?{}:{text_tone:'muted'}}},
      {primary:{text:request.model,note:request.provider_name,...mark(icons.get(request.provider),request.provider_name||request.model)}},
      {primary:{text:compact(tokens.input)??unknown}},
      {primary:rate==null?missing:{text:'',meter:{value:Math.min(rate,100),label:`${rate}%`,
        tone:low?'warning':'muted',...low?{icon:WARNING_ICON}:{}}}},
      {primary:{text:compact(tokens.output)??unknown}},
      {primary:first==null?missing:{text:duration(first,text),...lateStart(first)?{text_tone:'warning'}:{}}},
      {primary:elapsed==null?missing:{text:duration(elapsed,text),...longResponse(elapsed)?{text_tone:'warning'}:{}}},
      {primary:micros==null?missing:{text:`$${price(micros)}`}},
    ]);
    row_ids.push(`${request.position.node}:${request.position.timestamp_ms}:${request.position.sequence}`);
  }
  return {rows,cells,details,row_ids};
}
