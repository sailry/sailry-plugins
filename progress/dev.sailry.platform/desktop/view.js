// Accepted four-lane workbench layout; Kit owns controls, focus and scrolling.
import {div} from 'gpui-kit';
import {Icon,Tag,Skeleton} from 'gpui-component';
import {theme} from 'sailry';
import {EmptyState,Appearance,CardButton,ClampedText,ThinkingIcon,ScrollRegion,pageInsets,Collapse,CollapseSlot,SkeletonList} from 'sailry/ui';
import {lanes,labels,sections,clock,plain} from './state.js';
const glyphs = {waiting:'progress-4-line',running:'progress-2-line',completed:'progress-6-line',
  failed:'close-circle-line',idle:'checkbox-blank-circle-line'};
const variants = {waiting:'warning',running:'primary',completed:'success',failed:'danger',idle:'secondary'};
const tone = (lane,colors) => lane === 'waiting' ? colors.warning : lane === 'running' ? colors.primary
  : lane === 'completed' ? colors.success : lane === 'failed' ? colors.destructive : colors.muted_foreground;
const scrollKey = (view,lane,project) => `${view.board.catalog.node}-activity-project-${labels[lane]}-${project ?? 'none'}-cards`;

function card(view,item) {
  const {text} = view, colors = theme().colors;
  const id = item.kind === 'terminal' ? `activity-terminal-${item.id}` : `activity-${item.id}`;
  const preview = item.preview ? plain(item.preview) : '';
  const meta = (suffix,icon,value) => div().id(`${id}-${suffix}`).h_flex().flex_none().items_center().gap_1()
    .text_xs().text_color(colors.muted_foreground).child(new Icon(icon).size('xsmall')).child(value);
  view.targets.set(id,{kind:item.kind,id:item.id});
  return CardButton.new(id,{label:`${item.title}, ${item.status}, ${item.project}`,tooltip:item.status})
    .child(div().v_flex().w_full().min_w_0().items_start().gap_2()
      .child(div().id(`${id}-header`).h_flex().w_full().min_w_0().items_center().justify_between().gap_2()
        .child(div().id(`${id}-location`).h_flex().flex_1().min_w_0().items_center().gap_1p5()
          .text_xs().text_color(colors.muted_foreground)
          .child(div().id(`${id}-project-icon`).size_4().flex_shrink(0).child(Appearance.new(`${id}-appearance`,{value:item.appearance})))
          .child(div().id(`${id}-project`).min_w_0().truncate().child(item.project || text.sessions_unassigned)))
        .children(item.kind === 'terminal' ? [div().id(`${id}-kind`).flex_none().text_color(colors.muted_foreground)
          .child(new Icon('reicon:it/terminal-square').size('xsmall'))] : []))
      .child(div().id(`${id}-title`).w_full().min_w_0().h_6().line_height('1.5rem').text_left().text_base().font_semibold().truncate().child(item.title))
      .children(preview ? [ClampedText.new(`${id}-content`,{text:preview,lines:2})] : [])
      .child(div().id(`${id}-footer`).h_flex().w_full().min_w_0().items_center().gap_3().pt_1()
        .child(div().id(`${id}-state`).h_flex().flex_1().min_w_0().items_center().gap_1p5()
          .children(item.phase ? [ThinkingIcon.new(`${id}-loading`,{phase:item.phase})] : [])
          .child(new Tag().variant(variants[item.lane] ?? 'secondary').size('small').rounded_full().child(item.status)))
        .children(item.time === null ? [] : [meta('time','reicon:time/calendar',clock(item.time))])
        .children(item.duration ? [meta('duration','reicon:time/clock',item.duration)] : [])));
}

function project(view,lane,section) {
  const colors = theme().colors;
  const selector = `activity-project-${labels[lane]}-${section.id ?? 'none'}`;
  const identity = scrollKey(view,lane,section.id);
  return Collapse.new(`${view.board.catalog.node}-${selector}`,{label:section.name,default_open:true,variant:'plain'})
    .child(CollapseSlot.new(selector,{variant:'header'})
      .child(div().h_flex().w_full().min_w_0().gap_2()
        .child(Appearance.new(`${selector}-appearance`,{value:section.appearance}))
        .child(div().flex_1().min_w_0().truncate().text_left().text_sm().child(section.name))
        .child(div().text_xs().text_color(colors.muted_foreground).child(String(section.cards.length)))))
    .child(CollapseSlot.new(`${selector}-body`,{variant:'content'})
      .child(div().v_flex().w_full().min_w_0().pt_2()
        .child(div().id(`${selector}-viewport`).relative().w_full().min_w_0()
          // Natural height for short groups; the retained native region chains at its edges.
          .child(ScrollRegion.new(identity,{max_height:window.rem_size() * 32.5})
            .children(section.cards.map(item => card(view,item)))))));
}

export function render(view,cx) {
  const {board,text} = view, colors = theme().colors, rem = window.rem_size();
  const columns = sections(board.catalog,board.previews,text);
  const available = window.viewport_size().width - pageInsets().rail_width - rem * 2 - rem * 0.75 * 3;
  const width = Math.max(240,available / 4);
  view.targets = new Map();
  return div().v_flex().size_full().min_w_0().gap_4().p_4()
    .child(div().id('activity-board').h_flex().w_full().items_start().flex_1().min_h_0().gap_3().overflow_x_scrollbar()
      .children(lanes.map(lane => {
        const key = labels[lane], groups = columns[lane], count = groups.reduce((sum,section) => sum + section.cards.length,0);
        return div().id(`${key}-column`).v_flex().flex_none().w(width).h_full().gap_3()
          .child(div().id(`${key}-heading`).h_flex().w_full().gap_2().px_4().py_3().rounded(cx.theme().radius.lg).bg(colors.group_box).border_1().border_color(colors.border)
            .child(new Icon(`icons/remix/${glyphs[lane]}.svg`).size('small').color(tone(lane,colors)))
            .child(div().flex_1().font_semibold().text_sm().child(text[key]))
            .child(div().text_xs().px_2().rounded_md().bg(colors.muted).text_color(colors.muted_foreground)
              .child(board.catalog ? String(count) : new Skeleton().h_4().w_4())))
          .child(div().id(`${key}-items`).v_flex().flex_1().min_h_0().min_w_0().gap_3().overflow_y_scrollbar()
            .children(!board.catalog ? [SkeletonList.new(`${key}-loading`,{rows:2})] : [])
            .children(board.catalog && count === 0 ? [EmptyState.new(`${key}-empty`,{variant:'list',fill_height:true,vertical_align:'start',icon:'inbox',label:text.activity_board_empty})] : [])
            .children(groups.map(section => project(view,lane,section))));
      })));
}
