import {div} from 'gpui-kit';
import {Button} from 'gpui-base';
import {Collapsible,Icon} from 'gpui-component';
import {theme} from 'sailry';
import {compact,grouped,duration} from './format.js';
import {overview} from './context.js';

const colors=()=>theme().colors;
const column=()=>div().v_flex().w_full().min_w_0().gap(10);
const muted=value=>div().text_size(12).text_color(colors().muted_foreground).child(value);
const number=value=>compact(value)??'—';
const percent=value=>value==null?'—':`${value.toFixed(1)}%`;
const tokens=(value,estimated=false)=>value==null?'—':`${estimated?'≈ ':''}${number(value)}`;
const dot=color=>div().w(6).h(6).flex_shrink_0().rounded(2).bg(colors()[color]);
const arrow=open=>new Icon(`icons/chevron-${open?'down':'right'}.svg`).size('xsmall');
const spacer=()=>div().w(14).flex_shrink_0();
const speed=(value,text)=>value==null?'—':`${value.toFixed(1)} ${text.usage_speed_unit}`;
const span=(value,text)=>duration(value,text);

function row(label,value,color=null,note=null,count=null) {
  let content=div().h_flex().w_full().min_w_0().gap(8).items_center().text_size(14)
    .child(color?dot(color):div().w(6).flex_shrink_0())
    .child(div().flex_1().min_w_0().child(label))
    .children(count==null?[]:[muted(count).w(80)])
    .child(div().flex_shrink_0().child(value)).child(spacer());
  if(note) content=content.tooltip(note);
  return content;
}

function fold(view,id,body,label=view.text.context_details,value=null) {
  const open=view.expanded.has(id);
  return new Collapsible().w_full().open(open).motion_id(`context-${id}`)
    .child(Button.new(`context-${id}-toggle`).w_full().py(3).text_size(14)
      .accessibility_label(label).selected(open)
      .child(div().h_flex().w_full().items_center().gap(8)
        .child(div().flex_1().child(label))
        .children(value==null?[]:[div().child(value)])
        .child(div().w(14).flex_shrink_0().child(arrow(open))))
      .on_click((_,cx)=>{view.toggle(id);cx.notify();}))
    .content(column().pt(8).child(body));
}

function section(id,label,right,body,details) {
  let result=column().id(`context-section-${id}`).py(16)
    .child(div().h_flex().items_center().justify_between().gap(12)
      .child(div().text_size(14).font_semibold().child(label))
      .children(right==null?[]:[muted(right)]))
    .child(body).child(details);
  if(id!=='occupancy') result=result.border_t_1().border_color(colors().border);
  return result;
}

function bars(id,parts,whole=null) {
  const known=parts.length>0 && parts.every(part=>part.value!=null);
  const sum=known?parts.reduce((sum,part)=>sum+Number(part.value),0):0;
  const denominator=whole==null?sum:Number(whole);
  // Unknown categories are not normalized into a fabricated complete distribution.
  return div().id(id).h_flex().w_full().h(8).rounded(3).overflow_hidden().bg(colors().muted)
    .children(known && denominator>0?parts.filter(part=>Number(part.value)>0).map(part=>div().h_full()
      .flex_basis(0).flex_grow(Number(part.value)/denominator).bg(colors()[part.color])):[])
    .children(known && denominator>sum?[div().flex_basis(0).flex_grow((denominator-sum)/denominator)]:[]);
}

function grid(values) {
  return div().h_flex().w_full().gap(12).children(values.map(([label,value,note])=>{
    let cell=div().v_flex().flex_1().min_w_0().gap(5)
      .child(muted(label)).child(div().text_size(20).font_medium().child(value));
    return note?cell.tooltip(note):cell;
  }));
}

function occupancy(view,data) {
  const {text}=view,{used,chosen,snapshots}=data;
  const peak=Math.max(1,...snapshots.map(item=>Number(item.tokens??0n)));
  const history=div().h_flex().h(48).w_full().items_end().gap(2)
    .children(snapshots.map(item=>Button.new(`context-snapshot-${item.id}`).flex_1().min_w(3).h(48)
      .selected(item.id===chosen?.id).accessibility_label(`${text.context_step.replace('%{count}',String(item.step))}: ${tokens(item.tokens,item.estimated)}`)
      .tooltip(`${item.model} · ${tokens(item.tokens,item.estimated)}`)
      .child(div().h_full().w_full().v_flex().justify_end().child(div().w_full()
        .h(item.tokens==null||item.tokens===0n?0:Math.max(1,Number(item.tokens)/peak*44)).rounded(2)
        .bg(item.id===chosen?.id?colors().chart_1:colors().muted_foreground)))
      .on_click((_,cx)=>{view.selected=item.id;view.expanded.add('occupancy');cx.notify();})));
  const basis=used.basis?text[used.basis]:text.composer_metric_unknown;
  const header=div().h_flex().items_end().gap(6)
    .child(div().text_size(30).font_semibold().child(tokens(used.tokens,used.estimated)))
    .child(muted(`/ ${number(used.limit)}`)).child(div().flex_1())
    .child(div().text_size(22).child(percent(used.percent)));
  const remaining=used.threshold==null||used.tokens==null?null:used.threshold>used.tokens?used.threshold-used.tokens:0n;
  const meter=div().relative().w_full().child(bars('context-occupancy-bar',[{value:used.tokens,color:'chart_1'}],used.limit));
  if(used.limit>0n && used.threshold!=null) meter.child(div().absolute().top(-3).bottom(-3).w(1)
    .left(`${Math.min(100,Math.max(0,Number(used.threshold)/Number(used.limit)*100))}%`).bg(colors().muted_foreground)
    .tooltip(`${text.context_threshold} ${number(used.threshold)}`));
  if(used.limit>0n && used.reserve!=null) meter.child(div().absolute().top(0).bottom(0).right(0)
    .w(`${Math.min(100,Number(used.reserve)/Number(used.limit)*100)}%`).border_l_1().border_color(colors().muted_foreground)
    .tooltip(`${text.context_reserve} ${number(used.reserve)}`));
  const body=column().child(header)
    .child(meter)
    .child(div().h_flex().justify_between().gap(12)
      .child(muted(text.context_remaining.replace('%{count}',number(remaining))))
      .child(muted(`${text.context_reserve} ${number(used.reserve)}`)))
    .child(muted([used.model,basis].filter(Boolean).join(' · ')))
    .children(snapshots.length?[history,div().h_flex().justify_between().gap(12)
      .child(muted(text.context_step.replace('%{count}',String(chosen.step))))
      .child(muted(tokens(chosen.tokens,chosen.estimated)))]:[]);
  const detail=column().gap(8)
    .children((chosen?.parts??[]).map(part=>row(text[part.label],tokens(part.tokens,true),part.color,
      part.method==='identified_source_characters_quarter'?text.context_identified_note:null,
      text.context_items.replace('%{count}',grouped(part.items)??'—'))))
    .children(chosen?[muted(`${chosen.model} · ${number(chosen.limit)}`),
      ...(chosen.complete?[]:[muted(text.context_payload_partial)])]:[]);
  const record=view.state.statistics?.last_compaction;
  if(record?.id && record.turn && record.turn_sequence) detail.child(Button.new('context-record').w_full().py(3)
    .child(row(text.context_last_compaction,text[record.outcome==='succeeded'?'context_succeeded':'context_failed']))
    .on_click(()=>view.reveal({entry:record.id,turn:record.turn,turn_sequence:record.turn_sequence})));
  return section('occupancy',text.context_title,text.context_compactions.replace('%{count}',number(data.usage.compactions)),body,fold(view,'occupancy',detail));
}

function usage(view,data) {
  const {text}=view,value=data.usage;
  const body=column().child(grid([
    [text.usage_column_input,number(value.input),text.context_input_note],
    [text.usage_column_output,number(value.output),text.context_output_note],
    [text.context_cache_read,number(value.cached),text.context_cache_note],
    [text.usage_hit_rate,percent(value.cache)],
  ])).child(row(text.composer_cost,value.cost==null?'—':`≈ $${value.cost}`));
  const detail=column().gap(8)
    .child(row(text.context_steps,number(value.steps)))
    .child(row(text.context_replies,number(value.replies)))
    .child(value.tools.length?fold(view,'tools',column().gap(8).children(value.tools.map(tool=>row(tool.name,number(tool.count)))),text.context_tool_calls,number(value.toolCount))
      :row(text.context_tool_calls,number(value.toolCount)))
    .child(row(text.context_skills,number(value.skills)))
    .child(row(text.context_injected,number(value.injected)));
  if(value.children>0n) detail.child(row(text.composer_subagents,number(value.children)))
    .child(row(text.context_child_usage,number(value.delegated)));
  return section('usage',text.context_session_usage,text.context_turns.replace('%{count}',number(value.turns)),body,fold(view,'usage',detail));
}

function timing(view,data) {
  const {text}=view,value=data.timing;
  const parts=value.rows.filter(part=>part.id!=='thinking' && part.id!=='arguments');
  const body=column().child(bars('context-time-bar',parts,value.active))
    .child(div().h_flex().flex_wrap().gap(12).children(parts.map(part=>div().h_flex().items_center().gap(5)
      .child(dot(part.color)).child(muted(text[part.label])))));
  const detail=column().gap(8).children(value.rows.map(part=>row(text[part.label],span(part.value,text),part.color,
    part.id==='thinking'?text.context_thinking_note:null,
    part.value!=null && value.active>0n?percent(Number(part.value)*100/Number(value.active)):'—')))
    .child(row(text.usage_speed,speed(value.speed,text)));
  return section('timing',text.context_session_time,span(value.active,text),body,fold(view,'timing',detail));
}

function connection(view,data) {
  const {text}=view,value=data.connection;
  const node=(icon,label)=>div().v_flex().items_center().gap(5).flex_shrink_0()
    .child(new Icon(`icons/${icon}.svg`).size('medium')).child(muted(label));
  const link=(value,label)=>div().v_flex().flex_1().items_center().gap(4)
    .child(muted(span(value,text))).child(div().h_flex().w_full().items_center()
      .child(div().h(1).flex_1().bg(colors().border)).child(new Icon('icons/chevron-right.svg').size('xsmall')))
    .child(muted(label));
  const body=column().gap(14).child(div().h_flex().items_center().gap(10)
    .child(node('monitor',text.context_host)).child(link(value.headers,text.context_api_response))
    .child(node('network',text.context_api)).child(link(value.waiting,text.context_first_wait))
    .child(node('sparkles',text.context_ai)))
    .child(grid([[text.context_api_response,span(value.headers,text),text.context_headers_note],
      [text.composer_first_token,span(value.first,text),text.context_first_note],
      [text.composer_speed,speed(value.speed,text)],[text.usage_duration,span(value.elapsed,text)]]));
  const route=value.route==null?'—':text[`context_route_${value.route}`]??value.route;
  const detail=column().gap(8)
    .child(row(text.context_local_host,value.rtt==null?route:`${route} · ${span(Number(value.rtt)*1000,text)}`))
    .child(row(text.context_host_api,value.reused==null?'—':text[value.reused?'context_reused':'context_new_connection']))
    .child(row(text.context_handshake,span(value.handshake,text)))
    .child(row(text.context_http,value.status==null?'—':String(value.status)))
    .child(row(text.context_transport,value.transport??'—'))
    .child(row(text.context_freshness,span(value.freshness,text)));
  return section('connection',text.context_connection,null,body,fold(view,'connection',detail));
}

function composition(view,data) {
  const {text}=view,parts=data.composition;
  const body=column().child(bars('context-composition-bar',parts.map(part=>({...part,value:part.tokens}))))
    .child(div().h_flex().flex_wrap().gap(12).children(parts.map(part=>div().h_flex().items_center().gap(5)
      .child(dot(part.color)).child(muted(text[part.label])))));
  const detail=column().gap(8).children(parts.map(part=>row(text[part.label],tokens(part.tokens,part.estimated),part.color)));
  return section('composition',text.context_composition,number(data.usage.total),body,fold(view,'composition',detail));
}

export function render(view) {
  const data=overview(view.state,view.selected);
  return div().id('context-details').v_flex().w_full().max_w_full().min_h_0().px(20).text_size(14)
    .child(occupancy(view,data)).child(usage(view,data)).child(timing(view,data))
    .child(connection(view,data)).child(composition(view,data));
}
