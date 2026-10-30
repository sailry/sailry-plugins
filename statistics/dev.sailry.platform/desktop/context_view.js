import {div} from 'gpui-kit';
import {Button} from 'gpui-base';
import {Collapsible,Icon} from 'gpui-component';
import {theme} from 'sailry';
import {TextLine} from 'sailry/ui';
import {compact,duration} from './format.js';
import {overview,latency,shares} from './context.js';

/** Fixed step slots keep bar width stable; empty slots draw a short stub. */
const HISTORY_SLOTS=16;
const HISTORY_HEIGHT=34;
const STUB_HEIGHT=3;
const LEGEND={waiting:'context_wait_label',output:'context_reply',tools:'context_tools_label',other:'context_other'};

const colors=()=>theme().colors;
const column=()=>div().v_flex().w_full().min_w_0().gap(10);
const muted=value=>div().text_size(12).text_color(colors().muted_foreground).child(value);
const number=value=>compact(value)??'—';
const percent=value=>value==null?'—':`${value.toFixed(1)}%`;
const tokens=(value,estimated=false)=>value==null?'—':`${estimated?'≈ ':''}${number(value)}`;
const dot=color=>div().w(7).h(7).flex_shrink_0().rounded(2).bg(colors()[color]);
const arrow=open=>new Icon(`icons/chevron-${open?'down':'right'}.svg`).size('xsmall');
const known=value=>value!=null && value!=='';
const span=(value,text)=>value!=null && Number(value)>=60000000
  ?text.context_minutes.replace('%{minutes}',String(Math.floor(Number(value)/60000000)))
    .replace('%{seconds}',String(Math.floor(Number(value)/1000000)%60))
  :duration(value,text);

function row(label,value,{color=null,note=null}={}) {
  let content=div().h_flex().w_full().min_w_0().gap(8).items_center().py(4).text_size(13)
    .children(color?[dot(color)]:[])
    .child(div().flex_1().min_w_0().text_color(colors().muted_foreground).child(label))
    .child(div().flex_shrink_0().text_right().child(value));
  if(note) content=content.tooltip(note);
  return content;
}

function fold(view,id,body,label,value=null) {
  const open=view.expanded.has(id);
  // Kit materializes content before ordinary children; keep the trigger outside.
  return div().v_flex().w_full()
    .child(Button.new(`context-${id}-toggle`).w_full().min_h(22).py(2).text_size(13)
      .accessibility_label(label).selected(open)
      .child(div().h_flex().w_full().items_center().gap(8)
        .child(div().flex_1().text_color(colors().muted_foreground).child(label))
        .children(value==null?[]:[div().text_right().child(value)])
        .child(div().w(14).flex_shrink_0().child(arrow(open))))
      .on_click((_,cx)=>{view.toggle(id);cx.notify();}))
    .child(new Collapsible().w_full().open(open).motion_id(`context-${id}`)
      .content(column().gap(0).pt(6).child(body)));
}

function section(id,label,aside,children) {
  let result=column().gap(14).id(`context-section-${id}`).py(18)
    .child(div().h_flex().items_baseline().justify_between().gap(12)
      .child(div().text_size(14).font_medium().child(label))
      .children(known(aside)?[muted(aside)]:[]))
    .children(children.filter(Boolean));
  if(id!=='occupancy') result=result.border_t_1().border_color(colors().border);
  return result;
}

function bars(id,parts,whole=null,height=6) {
  return div().id(id).h_flex().items_stretch().w_full().h(height).flex_shrink_0().gap(1).rounded(3).overflow_hidden().bg(colors().muted)
    .children(shares(parts,whole).map(part=>div().h_full()
      .min_w(0).flex_shrink(1).w(`${part.share}%`).bg(colors()[part.color])));
}

function metric(id,value,size=26,tone='foreground',capacity=null,reference_size=null) {
  const runs=[{text:String(value),size,weight:500,color:colors()[tone]}];
  if(capacity!=null)runs.push({text:capacity,size:13,weight:400,color:colors().muted_foreground,gap:6});
  return TextLine.new(id,{runs,line_height:1.2,reference_size});
}

/** Equal-width figures; missing values drop out instead of showing a dash. */
function figures(id,values,size=20) {
  const present=values.filter(([,value])=>value!=null);
  if(!present.length)return null;
  return div().h_flex().w_full().gap(12).children(present.map(([label,value,note,tone],index)=>{
    const cell=div().id(`context-${id}-figure-${index}`).v_flex().flex_1().min_w_0().gap(6).child(muted(label))
      .child(div().text_size(size).font_medium().text_color(colors()[tone??'foreground']).child(value));
    return note?cell.tooltip(note):cell;
  }));
}

function history(view,data) {
  const {text}=view,{snapshots,chosen}=data;
  if(snapshots.length<2)return null;
  const recent=snapshots.slice(-HISTORY_SLOTS);
  const peak=Math.max(1,...recent.map(item=>Number(item.tokens??0n)));
  const stub=()=>div().w_full().h(STUB_HEIGHT).rounded_t(1).bg(colors().muted);
  const slots=Array.from({length:HISTORY_SLOTS},(_,index)=>{
    const item=recent[index];
    if(!item)return div().flex_1().min_w(0).h(HISTORY_HEIGHT).v_flex().justify_end().child(stub());
    const measured=item.tokens!=null && item.tokens>0n;
    return Button.new(`context-snapshot-${item.id}`).flex_1().min_w(0).h(HISTORY_HEIGHT).p(0).items_end()
      .selected(item.selected).accessibility_label(`${text.context_step.replace('%{count}',String(item.step))}: ${tokens(item.tokens,item.estimated)}`)
      .tooltip(`${text.context_step.replace('%{count}',String(item.step))} · ${tokens(item.tokens,item.estimated)}`)
      .child(measured?div().w_full().flex_shrink_0()
        .h(Math.max(STUB_HEIGHT,Number(item.tokens)/peak*HISTORY_HEIGHT)).rounded_t(2).bg(colors()[item.color]):stub())
      .on_click((_,cx)=>{view.select(item.id);cx.notify();});
  });
  return column().gap(6).child(div().h_flex().w_full().h(HISTORY_HEIGHT).items_end().gap(4).children(slots))
    .children(chosen?[muted(`${text.context_step.replace('%{count}',String(chosen.step))} · ${tokens(chosen.tokens,chosen.estimated)}`)]:[]);
}

function occupancy(view,data) {
  const {text}=view,{used,chosen,detail}=data;
  const compactions=data.usage.compactions!=null && data.usage.compactions>0n
    ?text.context_compactions.replace('%{count}',number(data.usage.compactions)):null;
  const basis=used.basis?text[used.basis]:null;
  const header=div().h_flex().items_baseline().gap(5)
    .child(metric('context-occupancy-tokens',tokens(used.tokens,used.estimated),26,'foreground',
      used.limit==null?null:`/ ${number(used.limit)}`,26))
    .child(div().flex_1())
    .children(used.percent==null?[]:[metric('context-occupancy-percent',percent(used.percent),15,'muted_foreground',null,26)]);
  if(basis)header.tooltip(basis);
  const meter=div().relative().w_full().child(bars('context-occupancy-bar',[{value:used.tokens,color:'chart_2'}],used.limit));
  if(used.limit>0n && used.threshold!=null) meter.child(div().absolute().top(-3).bottom(-3).w(1)
    .left(`${Math.min(100,Math.max(0,Number(used.threshold)/Number(used.limit)*100))}%`).bg(colors().muted_foreground)
    .tooltip(`${text.context_threshold} ${number(used.threshold)}`));
  if(used.limit>0n && used.reserve!=null) meter.child(div().absolute().top(0).bottom(0).right(0)
    .w(`${Math.min(100,Number(used.reserve)/Number(used.limit)*100)}%`).border_l_1().border_color(colors().muted_foreground)
    .tooltip(`${text.context_reserve} ${number(used.reserve)}`));
  const remaining=used.threshold==null||used.tokens==null?null:used.threshold>used.tokens?used.threshold-used.tokens:0n;
  const notes=[remaining==null?null:text.context_remaining.replace('%{count}',number(remaining)),
    used.reserve==null?null:`${text.context_reserve} ${number(used.reserve)}`].filter(Boolean);
  const parts=detail.parts.filter(part=>part.tokens!=null && part.tokens>0n);
  const details=column().gap(0)
    .children(parts.map(part=>row(text[part.label],tokens(part.tokens,true),{color:part.color,
      note:part.method==='identified_source_characters_quarter'?text.context_identified_note:null})));
  const note=[chosen?`${chosen.model} · ${number(chosen.limit)}`:null,
    detail.complete?null:text.context_payload_partial].filter(Boolean).join(' · ');
  if(note)details.tooltip(note);
  const record=view.state.statistics?.last_compaction;
  const revealable=record?.id && record.turn && record.turn_sequence;
  if(revealable) details.child(Button.new('context-record').w_full().p(0)
    .child(row(text.context_last_compaction,text[record.outcome==='succeeded'?'context_succeeded':'context_failed']))
    .on_click(()=>view.reveal({entry:record.id,turn:record.turn,turn_sequence:record.turn_sequence})));
  return section('occupancy',text.context_title,[used.model,compactions].filter(Boolean).join(' · '),[
    header,meter,
    notes.length?div().h_flex().justify_between().gap(12).children(notes.map(muted)):null,
    history(view,data),
    parts.length||revealable?fold(view,'occupancy',details,text.context_details):null,
  ]);
}

function usage(view,data) {
  const {text}=view,value=data.usage;
  const aside=[value.turns==null?null:text.context_turns.replace('%{count}',number(value.turns)),
    value.cost==null?null:`≈ $${value.cost}`].filter(Boolean).join(' · ');
  const hit=value.cache==null?null:Math.min(100,Math.max(0,value.cache));
  const numbers=figures('usage',[
    [text.usage_column_input,compact(value.input),text.context_input_note],
    [text.usage_column_output,compact(value.output),
      value.reasoning==null?text.context_output_note:`${text.usage_column_reasoning} ${number(value.reasoning)}`],
    [text.context_cache_hit,hit==null?null:`${Math.round(hit)}%`,
      value.cached==null?null:`${text.context_cache_read} ${number(value.cached)}`],
  ]);
  const cache=hit==null?null:div().id('context-cache-bar').w_full().h(6).rounded(3).overflow_hidden().bg(colors().muted)
    .child(div().h_full().w(`${hit}%`).rounded(3).bg(colors().success));
  const tools=value.toolCount==null?null:value.tools.length
    ?fold(view,'tools',column().gap(0).children(value.tools.map(tool=>row(tool.name,number(tool.count)))),
      text.context_tool_calls,number(value.toolCount))
    :row(text.context_tool_calls,number(value.toolCount));
  const children=value.children!=null && value.children>0n
    ?fold(view,'children',row(text.context_child_usage,number(value.delegated)),text.composer_subagents,number(value.children))
    :null;
  const entries=tools||children?column().gap(4).children([tools,children].filter(Boolean)):null;
  if(!numbers && !entries)return null;
  return section('usage',text.context_session_usage,aside,[numbers,cache,entries]);
}

function timing(view,data) {
  const {text}=view,value=data.timing;
  const parts=value.rows.filter(part=>LEGEND[part.id] && part.value!=null && part.value>0n);
  if(!parts.length)return null;
  const item=part=>div().h_flex().flex_1().min_w_0().items_center().gap(6)
    .child(dot(part.color)).child(muted(text[LEGEND[part.id]])).child(div().flex_1())
    .child(div().text_size(12).child(span(part.value,text)));
  const pairs=[];
  for(let index=0;index<parts.length;index+=2) pairs.push(div().h_flex().w_full().gap(16)
    .child(item(parts[index])).child(parts[index+1]?item(parts[index+1]):div().flex_1()));
  return section('timing',text.context_session_time,value.active==null?null:span(value.active,text),[
    bars('context-time-bar',parts,value.active),
    column().gap(6).children(pairs),
    value.speed==null?null:muted(`${text.context_output_speed} ${value.speed} ${text.usage_speed_unit}`),
  ]);
}

function connection(view,data) {
  const {text}=view,value=data.connection;
  const numbers=figures('connection',[
    [text.context_api_response,value.response==null?null:span(value.response,text),text.context_headers_note,latency(value.response,'response')],
    [text.context_first_response,value.first==null?null:span(value.first,text),text.context_first_note,latency(value.first,'waiting')],
    [text.context_request_time,value.elapsed==null?null:span(value.elapsed,text)],
  ],16);
  return numbers?section('connection',text.context_connection,null,[numbers]):null;
}

export function render(view) {
  const data=overview(view.state,view.selected);
  return div().id('context-details').v_flex().w_full().max_w_full().min_h_0().px(18).text_size(14)
    .children([occupancy(view,data),usage(view,data),timing(view,data),connection(view,data)].filter(Boolean));
}
