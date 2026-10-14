import {div} from 'gpui-kit';
import {Button,Progress,Tab,TabBar,Tag,Pagination} from 'gpui-component';
import {theme,Header} from 'sailry';
import {SettingsGroup,DataTable,Heatmap,StackedChart,ProgressBar,Loading} from 'sailry/ui';
import {compact,grouped} from './format.js';
import {heatmap,trend,SERIES} from './charts.js';
import {overview,percent} from './summary.js';
import {breakdown,VISIBLE} from './breakdown.js';
import {formatRows} from './requests.js';
import {unit,DIMENSIONS} from './state.js';

const column = () => div().v_flex().min_w_0().gap_3();
const label = text => div().text_sm().font_semibold().child(text);
const muted = text => div().text_sm().text_color(theme().colors.muted_foreground).child(text);
const card = (id,body) => div().id(id).min_w_0().child(SettingsGroup.new(`${id}-box`,{heading:false}).child(div().py_4().child(body)));
const dot = color => div().flex_shrink_0().w_2().h_2().rounded_sm().bg(theme().colors[color]);
const legend = text => div().h_flex().flex_wrap().gap_3().children(SERIES.map(series=>div().h_flex().gap_1p5().items_center()
  .child(dot(series.color)).child(muted(text[series.label]).text_xs())));
const missing = text => ({text:text.composer_metric_unknown,text_tone:'muted'});

function composition(parts,sum) {
  // Kit Progress shows one value; flexible divs keep the three token parts proportional.
  return div().id('usage-composition').h_flex().w_full().h_2().mt_3().gap(2).rounded_full().overflow_hidden()
    .bg(theme().colors.muted)
    .children(sum>0n ? SERIES.map((series,index)=>[series,parts[index],index]).filter(([,value])=>value>0n)
      .map(([series,value,index])=>div().h_full().flex_basis(0).flex_grow(Number(value)/Number(sum))
        .min_w(index===2?3:0).bg(theme().colors[series.color])) : []);
}

function stat(id,name,value,extra=[]) {
  return column().id(`usage-stat-${id}`).flex_1().min_w_0().gap_1().child(muted(name).text_xs())
    .child(div().h_flex().items_center().gap_1p5().min_w_0().child(div().text_lg().font_semibold().truncate().child(value)).children(extra));
}

function summary(view,totals) {
  const {text}=view,colors=theme().colors,unknown=text.composer_metric_unknown,values=overview(totals);
  const narrow=window.viewport_size().width<1000;
  const tokens=column().flex_1().min_w_0().gap_0()
    .child(muted(text.composer_tokens).text_xs())
    .child(div().id('usage-total').mt_1().text_3xl().font_semibold().tooltip(grouped(values.total)??unknown).child(compact(values.total)??unknown))
    .child(composition(values.parts,values.total??0n))
    .child(div().h_flex().flex_wrap().gap_x(14).gap_y(4).mt_3().children(SERIES.map((series,index)=>div().id(`usage-part-${series.id}`)
      .h_flex().gap_1p5().items_center().child(dot(series.color)).child(muted(text[series.label]).text_xs())
      .child(div().text_xs().font_medium().child(compact(values.parts?.[index])??unknown))
      .child(muted(percent(values.shares?.[index])??'').text_xs()))))
    .child(muted(text.usage_reasoning_share.replace('%{value}',compact(values.reasoning)??unknown)).mt_1p5().text_xs());
  const priced=text.usage_cost_priced.replace('%{priced}',grouped(values.priced)).replace('%{responses}',grouped(values.responses));
  const stats=[
    stat('hit',text.usage_hit_rate,values.hit==null?unknown:`${Math.round(values.hit)}%`)
      .child(div().w(96).child(ProgressBar.new('usage-hit-bar',{value:values.hit??0,color:'chart_3',label:text.usage_hit_rate}))),
    stat('responses',text.usage_responses,grouped(values.responses)),
    stat('speed',text.usage_speed,values.speed??unknown,values.speed==null?[]:[muted(text.usage_speed_unit).text_xs()]),
    stat('cost',text.usage_cost,values.cost==null?unknown:`$${values.cost}`,values.partial?[div().id('usage-cost-partial').tooltip(priced)
      .child(new Tag().variant('secondary').size('small').rounded_full().child(text.usage_cost_partial))]:[]),
  ];
  const figures=narrow
    ? div().h_flex().gap_5().mt_4().pt_4().border_t_1().border_color(colors.border).children(stats)
    : column().w(380).flex_shrink_0().justify_center().gap_5().pl_6().border_l_1().border_color(colors.border)
      .child(div().h_flex().gap_5().children(stats.slice(0,2))).child(div().h_flex().gap_5().children(stats.slice(2)));
  return (narrow ? div().v_flex() : div().h_flex().items_stretch().gap_6()).min_w_0().child(tokens).child(figures);
}

function activity(view,data) {
  const {state,text}=view,t=key=>text[key],granularity=unit(state.range);
  const year=state.range==='1y' ? heatmap(data.days,t) : null;
  return column()
    .child(div().h_flex().justify_between().items_center().gap_3().child(label(text.usage_trend)).child(legend(text)))
    .child(StackedChart.new(`usage-trend-${granularity}`,trend(data,granularity,t)))
    .children(year ? [column().id('usage-activity').gap_2().mt_2().pt_4().border_t_1().border_color(theme().colors.border)
      .child(muted(text.usage_active_days.replace('%{count}',String(year.active))).text_xs())
      .child(Heatmap.new('usage-heatmap-plot',{rows:year.rows,columns:year.columns,cells:year.cells}))] : [])
    .child(div().h_flex().justify_end().child(muted(text.usage_local_time).text_xs()));
}

function distribution(view,data) {
  const {state,text}=view,unknown=text.composer_metric_unknown;
  const inventory=view.inventory?.node===data.node ? view.inventory : null;
  const names={providers:new Map((inventory?.providers ?? []).map(item=>[item.id,item.name])),
    projects:new Map((inventory?.projects ?? []).map(item=>[item.id,item.name]))};
  // A grouping change keeps the previous report until the regrouped report arrives.
  const pending=(data.query?.dimension ?? 'model')!==state.query.dimension;
  const rows=pending ? [] : breakdown(data.groups,state.breakdown,names,text);
  const shown=state.expanded ? rows : rows.slice(0,VISIBLE);
  const fields=['name','share','tokens','hit','responses','cost'];
  const table=pending ? div().id('usage-breakdown-pending').relative().w_full().h(160).child(Loading.new('usage-breakdown-loading'))
    : div().id('usage-breakdown-table').w_full().min_w_0().h(32+(shown.length ? shown.length*36 : 160))
      .child(DataTable.new('usage-breakdown',{revision:`${state.generation}:${state.breakdown}`,columns:fields.map(key=>text[`usage_column_${key}`]),
        rows:shown.map(row=>[row.note ? `${row.name} · ${row.note}` : row.name,percent(row.share)??unknown,row.total==null ? unknown : String(row.total),
          row.hit==null ? unknown : `${Math.round(row.hit)}%`,String(row.responses),row.cost==null ? unknown : `$${row.cost}`]),
        cells:shown.map(row=>[
          {primary:{text:row.name,...row.note ? {note:row.note} : {}}},
          {primary:{text:'',meter:{value:Math.min(row.share ?? 0,100),label:percent(row.share)??unknown,width:120}}},
          {primary:{text:compact(row.total)??unknown}},
          {primary:row.hit==null ? missing(text) : {text:`${Math.round(row.hit)}%`}},
          {primary:{text:grouped(row.responses)}},
          {primary:row.cost==null ? missing(text) : {text:`$${row.cost}`}},
        ]),
        row_ids:shown.map(row=>row.id),row_height:36,header_height:32,widths:[260,190,90,90,80,90],
        alignments:fields.map((_,index)=>index<2 ? 'start' : 'end'),resizable:false,empty:text.usage_empty,empty_icon:'chart-pie'}));
  return column().id('usage-breakdown-section')
    .child(div().h_flex().justify_between().items_center().gap_3().child(label(text.usage_breakdown))
      .child(new TabBar('usage-breakdown-tabs').variant('segmented').selected_index(DIMENSIONS.indexOf(state.breakdown))
        .children(DIMENSIONS.map(id=>new Tab().label(text[`usage_column_${id}`])))
        .on_change((index,cx)=>view.group(DIMENSIONS[index],cx))))
    .child(table)
    .children(rows.length>VISIBLE ? [div().child(new Button('usage-breakdown-more').ghost().size('small')
      .label(state.expanded ? text.usage_collapse : text.usage_show_all.replace('%{count}',String(rows.length)))
      .on_click((_,cx)=>{state.expanded=!state.expanded;cx.notify();}))] : []);
}

function requests(view,data) {
  const {state,text}=view,rows=formatRows(data.requests.items,text);
  const fields=['time','session','model','input_cache','output','first_token','duration','cost'];
  const rowHeight=40,headerHeight=32;
  return column().child(label(text.usage_requests))
    .child(div().id('usage-table').w_full().min_w_0().h(headerHeight+(rows.rows.length ? rows.rows.length*rowHeight : 192))
      .child(DataTable.new('usage-requests',{revision:`${state.generation}:${state.cursor}`,columns:fields.map(key=>text[`usage_column_${key}`]),
        ...rows,row_height:rowHeight,header_height:headerHeight,widths:[108,172,176,140,60,60,64,72],
        alignments:fields.map((_,index)=>index<3 ? 'start' : 'end'),resizable:false,empty:text.usage_empty,empty_icon:'chart-pie'})))
    .child(div().id('usage-pagination').h_flex().items_center().justify_between().gap_3()
      .child(muted(text.usage_count.replace('%{count}',grouped(data.totals?.responses ?? '0'))).text_xs())
      .children(state.page>1||data.requests.has_more ? [new Pagination('usage-pages').size('small').current_page(state.page)
        .total_pages(Math.max(state.cursors.length,state.page+Number(data.requests.has_more)))
        .disabled(!state.ready()).on_change((page,cx)=>view.page(page,cx))] : []));
}

export function render(view) {
  const {state,text}=view,data=state.data();
  const refreshing=state.view?.refreshing;
  const body=column().id('usage-content').relative().w_full().max_w(1040).mx_auto().p_6().gap_4()
    .children(!data ? [div().relative().w_full().h_64().child(Loading.new('usage-initial-loading'))] : [])
    .children(data&&!view.error&&(state.previous||refreshing)?[div().absolute().top_0().left_6().right_6()
      .child(new Progress('usage-loading').loading(true).size('xsmall').accessibility_label(text.usage_loading))]:[]);
  if(data)body.child(card('usage-summary',summary(view,data.totals)))
    .child(card('usage-trend-card',activity(view,data)))
    .child(card('usage-breakdown-card',distribution(view,data)))
    .child(card('usage-requests-card',requests(view,data)));
  return div().id('usage-page').v_flex().size_full().min_w_0().min_h_0().child(Header.new('usage-header',{content:JSON.stringify(view.header())})).child(div().id('usage-scroll').flex_1().min_h_0().min_w_0().overflow_y_scroll().child(body));
}
