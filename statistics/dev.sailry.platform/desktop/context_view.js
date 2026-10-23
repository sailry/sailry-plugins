import {div} from 'gpui-kit';
import {Button} from 'gpui-base';
import {Collapsible,Icon,Label} from 'gpui-component';
import {theme} from 'sailry';
import {compact,grouped,duration} from './format.js';
import {overview,latency} from './context.js';

const colors=()=>theme().colors;
const column=()=>div().v_flex().w_full().min_w_0().gap(10);
const muted=value=>div().text_size(12).text_color(colors().muted_foreground).child(value);
const number=value=>compact(value)??'—';
const percent=value=>value==null?'—':`${value.toFixed(1)}%`;
const tokens=(value,estimated=false)=>value==null?'—':`${estimated?'≈ ':''}${number(value)}`;
const dot=color=>div().w(7).h(7).flex_shrink_0().rounded(2).bg(colors()[color]);
const arrow=open=>new Icon(`icons/chevron-${open?'down':'right'}.svg`).size('xsmall');
const spacer=()=>div().w(14).flex_shrink_0();
const speed=(value,text)=>value==null?'—':`${value.toFixed(1)} ${text.usage_speed_unit}`;
const span=(value,text)=>value!=null && Number(value)>=60000000
  ?text.context_minutes.replace('%{minutes}',String(Math.floor(Number(value)/60000000)))
    .replace('%{seconds}',String(Math.floor(Number(value)/1000000)%60))
  :duration(value,text);

function row(label,value,{color=null,note=null,count=null,icons=false,disclosure=false}={}) {
  let content=div().h_flex().w_full().min_w_0().gap(8).items_center().py(5).text_size(14)
    .children(color||icons?[div().w(14).flex_shrink_0().children(color?[dot(color)]:[])]:[])
    .child(div().flex_1().min_w_0().text_color(colors().muted_foreground).child(label))
    .children(count==null?[]:[muted(count).w(50).flex_shrink_0().text_right()])
    .child(div().w(count==null?120:80).flex_shrink_0().text_right().child(value))
    .children(disclosure?[spacer()]:[]);
  if(note) content=content.tooltip(note);
  return content;
}

function fold(view,id,body,label=view.text.context_details,value=null) {
  const open=view.expanded.has(id);
  // Kit materializes content before ordinary children; keep the trigger outside.
  return div().v_flex().w_full()
    .child(Button.new(`context-${id}-toggle`).w_full().min_h(22).py(value==null?0:5).text_size(14)
      .accessibility_label(label).selected(open)
      .child(div().h_flex().w_full().items_center().gap(8)
        .child(div().flex_1().text_color(colors().muted_foreground).child(label))
        .children(value==null?[]:[div().w(120).text_right().child(value)])
        .child(div().w(14).flex_shrink_0().child(arrow(open))))
      .on_click((_,cx)=>{view.toggle(id);cx.notify();}))
    .child(new Collapsible().w_full().open(open).motion_id(`context-${id}`)
      .content(column().gap(0).pt(value!=null?0:id==='occupancy'?8:13).child(body)));
}

function section(id,label,right,body,details) {
  let result=column().gap(12).id(`context-section-${id}`).py(14)
    .child(div().h_flex().items_center().justify_between().gap(12)
      .child(div().text_size(14).font_medium().child(label))
      .children(right==null?[]:[muted(right)]))
    .child(body).child(div().pt(2).child(details));
  if(id==='occupancy') result=result.pb(18);
  if(id==='timing') result=result.pb(17);
  if(id!=='occupancy') result=result.border_t_1().border_color(colors().border);
  return result;
}

function bars(id,parts,whole=null) {
  const known=parts.length>0 && parts.every(part=>part.value!=null);
  const sum=known?parts.reduce((sum,part)=>sum+Number(part.value),0):0;
  const denominator=whole==null?sum:Number(whole);
  // Unknown categories are not normalized into a fabricated complete distribution.
  return div().id(id).h_flex().items_stretch().w_full().h(8).flex_shrink_0().rounded(3).overflow_hidden().bg(colors().muted)
    .children(known && denominator>0?parts.filter(part=>Number(part.value)>0).map(part=>div().h_full()
      .min_w(0).flex_shrink_0().w(`${Math.min(100,Number(part.value)/denominator*100)}%`).bg(colors()[part.color])):[]);
}

function metric(value,size=23,tone='foreground') {
  const match=String(value).match(/^([≈\s]*[\d.,]+)\s*(.*)$/);
  // Kit's secondary label keeps its primary font size, so compose sized labels.
  return div().h_flex().items_baseline().gap(3)
    .child(new Label(match?match[1]:String(value)).text_size(size).line_height(1.2).font_medium().text_color(colors()[tone]))
    .children(match?.[2]?[new Label(match[2]).text_size(12).line_height(1.2).text_color(colors().muted_foreground)]:[]);
}

function grid(values) {
  return div().h_flex().w_full().gap(12).children(values.map(([label,value,note])=>{
    let cell=div().v_flex().flex_1().min_w_0().gap(8)
      .child(div().text_size(14).text_color(colors().muted_foreground).child(label)).child(metric(value));
    return note?cell.tooltip(note):cell;
  }));
}

function occupancy(view,data) {
  const {text}=view,{used,chosen,snapshots}=data;
  const peak=Math.max(1,...snapshots.map(item=>Number(item.tokens??0n)));
  const history=div().h_flex().h(47).w_full().items_end().gap(5)
    .children(snapshots.map(item=>Button.new(`context-snapshot-${item.id}`).flex_1().min_w(0).h(47).p(0).items_end()
      .selected(item.id===chosen?.id).accessibility_label(`${text.context_step.replace('%{count}',String(item.step))}: ${tokens(item.tokens,item.estimated)}`)
      .tooltip(`${item.model} · ${tokens(item.tokens,item.estimated)}`)
      .child(div().w_full().flex_shrink_0()
        .h(item.tokens==null||item.tokens===0n?0:Math.max(1,Number(item.tokens)/peak*47)).rounded_t(2)
        .bg(colors().chart_2).opacity(item.id===chosen?.id?1:0.38))
      .on_click((_,cx)=>{view.selected=item.id;view.expanded.add('occupancy');cx.notify();})));
  const basis=used.basis?text[used.basis]:text.composer_metric_unknown;
  const header=div().h_flex().items_baseline().gap(5)
    .child(metric(tokens(used.tokens,used.estimated),30))
    .child(new Label(`/ ${number(used.limit)}`).text_size(14).line_height(1.2).text_color(colors().muted_foreground))
    .child(div().flex_1())
    .child(metric(percent(used.percent),22,'muted_foreground')).tooltip([used.model,basis].filter(Boolean).join(' · '));
  const remaining=used.threshold==null||used.tokens==null?null:used.threshold>used.tokens?used.threshold-used.tokens:0n;
  const meter=div().relative().w_full().child(bars('context-occupancy-bar',[{value:used.tokens,color:'chart_2'}],used.limit).h(9));
  if(used.limit>0n && used.threshold!=null) meter.child(div().absolute().top(-3).bottom(-3).w(1)
    .left(`${Math.min(100,Math.max(0,Number(used.threshold)/Number(used.limit)*100))}%`).bg(colors().muted_foreground)
    .tooltip(`${text.context_threshold} ${number(used.threshold)}`));
  if(used.limit>0n && used.reserve!=null) meter.child(div().absolute().top(0).bottom(0).right(0)
    .w(`${Math.min(100,Number(used.reserve)/Number(used.limit)*100)}%`).border_l_1().border_color(colors().muted_foreground)
    .tooltip(`${text.context_reserve} ${number(used.reserve)}`));
  const body=column().gap(8).child(div().pb(4).child(header))
    .child(meter)
    .child(div().h_flex().justify_between().gap(12)
      .child(muted(text.context_remaining.replace('%{count}',number(remaining))))
      .child(muted(`${text.context_reserve} ${number(used.reserve)}`)))
    .children(snapshots.length?[div().pt(9).child(history),div().h_flex().justify_between().gap(12)
      .child(muted(text.context_step.replace('%{count}',String(chosen.step))))
      .child(muted(text.context_token_count.replace('%{count}',tokens(chosen.tokens,chosen.estimated))))]:[]);
  const detail=column().gap(0)
    .children((chosen?.parts??[]).map(part=>row(text[part.label],tokens(part.tokens,true),{
      color:part.color,note:part.method==='identified_source_characters_quarter'?text.context_identified_note:null,
      count:text.context_items.replace('%{count}',grouped(part.items)??'—')})))
    .tooltip(chosen?[`${chosen.model} · ${number(chosen.limit)}`,chosen.complete?null:text.context_payload_partial].filter(Boolean).join(' · '):basis);
  const record=view.state.statistics?.last_compaction;
  if(record?.id && record.turn && record.turn_sequence) detail.child(Button.new('context-record').w_full().py(3)
    .child(row(text.context_last_compaction,text[record.outcome==='succeeded'?'context_succeeded':'context_failed'],{icons:true}))
    .on_click(()=>view.reveal({entry:record.id,turn:record.turn,turn_sequence:record.turn_sequence})));
  return section('occupancy',text.context_title,text.context_compactions.replace('%{count}',number(data.usage.compactions)),body,fold(view,'occupancy',detail));
}

function usage(view,data) {
  const {text}=view,value=data.usage;
  const disclosure=value.tools.length>0;
  const item=(label,value)=>row(label,value,{disclosure});
  const body=column().child(grid([
    [text.usage_column_input,number(value.input),text.context_input_note],
    [text.usage_column_output,number(value.output),text.context_output_note],
    [text.context_cache_read,number(value.cached),text.context_cache_note],
    [text.context_cache_hit,percent(value.cache)],
  ])).child(div().h_flex().items_baseline().gap(6).pt(2)
    .child(muted(text.context_cost)).child(div().text_size(14).font_medium().child(value.cost==null?'—':`≈ $${value.cost}`)));
  const detail=column().gap(0)
    .child(item(text.context_steps,number(value.steps)))
    .child(item(text.context_replies,number(value.replies)))
    .child(value.tools.length?fold(view,'tools',column().gap(0).children(value.tools.map(tool=>row(tool.name,number(tool.count)))),text.context_tool_calls,number(value.toolCount))
      :item(text.context_tool_calls,number(value.toolCount)))
    .child(item(text.context_skills,number(value.skills)))
    .child(item(text.context_injected,number(value.injected)));
  if(value.children>0n) detail.child(item(text.composer_subagents,number(value.children)))
    .child(item(text.context_child_usage,number(value.delegated)));
  return section('usage',text.context_session_usage,text.context_turns.replace('%{count}',number(value.turns)),body,fold(view,'usage',detail));
}

function timing(view,data) {
  const {text}=view,value=data.timing;
  const parts=value.rows.filter(part=>part.id!=='thinking' && part.id!=='arguments');
  const legend=value.rows.filter(part=>!['arguments','other'].includes(part.id));
  const body=column().child(bars('context-time-bar',parts,value.active))
    .child(div().h_flex().flex_wrap().gap(19).children(legend.map(part=>div().h_flex().items_center().gap(6)
      .child(dot(part.color)).child(muted(text[({waiting:'context_wait_label',thinking:'context_thinking_label',tools:'context_tools_label'})[part.id]??part.label])))));
  const detail=column().gap(0).children(value.rows.map(part=>{
    const colored=!['arguments','other'].includes(part.id);
    let line=div().h_flex().w_full().items_center().gap(8).py(6).text_size(14)
      .child(div().w(14).flex_shrink_0().children(colored?[dot(part.color)]:[]))
      .child(div().flex_1().min_w_0().child(text[part.label]))
      .child(div().w(90).flex_shrink_0().text_right().child(span(part.value,text)))
      .child(muted(part.value!=null && value.active>0n?percent(Number(part.value)*100/Number(value.active)):'—').w(64).flex_shrink_0().text_right());
    return part.id==='thinking'?line.tooltip(text.context_thinking_note):line;
  })).child(div().h_flex().items_center().gap(8).py(6).text_size(14)
    .child(div().w(14).flex_shrink_0()).child(div().flex_1().child(text.usage_speed))
    .child(div().w(90).flex_shrink_0().text_right().child(speed(value.speed,text)))
    .child(div().w(64).flex_shrink_0()));
  return section('timing',text.context_session_time,span(value.active,text),body,fold(view,'timing',detail));
}

function connection(view,data) {
  const {text}=view,value=data.connection;
  const node=(icon,label)=>div().v_flex().items_center().gap(4).flex_basis(0).flex_grow(1).min_w_0()
    .child(div().w(28).h(28).h_flex().items_center().justify_center().rounded(7)
      .border_1().border_color(colors().border).bg(colors().muted)
      .child(new Icon(`icons/${icon}.svg`).size('small')))
    .child(div().text_size(14).child(label));
  const link=(value,label,note,phase)=>{
    const color=colors()[latency(value,phase)];
    return div().v_flex().flex_basis(0).flex_grow(0.82).min_w(50).items_center().gap(5)
      .tooltip(note).child(muted(span(value,text)))
      .child(div().h_flex().w_full().h(1).relative().bg(color)
        .child(div().absolute().right(-2).top(-6).text_color(color)
          .child(new Icon('icons/chevron-right.svg').size('xsmall'))))
      .child(muted(label));
  };
  const body=column().gap(10).child(div().h_flex().items_start().gap(3).pt(2).pb(10)
    .child(node('monitor',text.context_host)).child(link(value.response,text.context_api_response,text.context_headers_note,'response'))
    .child(node('server',text.context_api)).child(link(value.waiting,text.context_first_wait,text.context_wait_note,'waiting'))
    .child(node('brain-circuit',text.context_ai)))
    .child(grid([[text.context_api_response,span(value.response,text),text.context_headers_note],
      [text.context_first_response,span(value.first,text),text.context_first_note],
      [text.context_output_speed,speed(value.speed,text)],[text.context_request_time,span(value.elapsed,text)]]));
  const route=value.route==null?'—':text[`context_route_${value.route}`]??value.route;
  const detail=column().gap(0)
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
    .child(div().h_flex().flex_wrap().gap(15).children(parts.map(part=>div().h_flex().items_center().gap(6)
      .child(dot(part.color)).child(muted(text[part.label])))));
  const detail=column().gap(0).children(parts.map(part=>row(text[part.label],tokens(part.tokens,part.estimated),{color:part.color})));
  return section('composition',text.context_composition,text.context_token_count.replace('%{count}',number(data.usage.total)),body,fold(view,'composition',detail));
}

export function render(view) {
  const data=overview(view.state,view.selected);
  return div().id('context-details').v_flex().w_full().max_w_full().min_h_0().px(20).text_size(14)
    .child(occupancy(view,data)).child(usage(view,data)).child(composition(view,data))
    .child(timing(view,data)).child(connection(view,data));
}
