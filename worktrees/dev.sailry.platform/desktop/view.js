// Approved forms composed with native Kit fields, buttons, checkbox and modal.
import {div} from 'gpui-kit';
import {Button,Checkbox,Field,Form,List,Icon,Separator} from 'gpui-component';
import {TextField} from 'sailry/forms';
import {Modal} from 'sailry/ui';

function button(id,label,action,disabled = false,primary = false) {
  let control = new Button(id).label(label).disabled(disabled).on_click(action);
  if (primary) control = control.primary();
  return div().id(id).child(control);
}
function footer(view,owner,submit,cancel) {
  return div().h_flex().w_full().mt_3().justify_end().gap_2()
    .children(owner.uncertain && owner.kind === 'create' ? [button('live-worktree-recover',view.text('workspace_project'),(_,cx) => view.overview(cx))] : [])
    .child(button(cancel,view.text('settings_cancel'),(_,cx) => view.close(cx)))
    .child(button(submit,view.text(owner.request && owner.kind !== 'create' ? 'worktree_retry' : owner.kind === 'remove' ? 'worktree_remove' : 'worktree_create'),(_,cx) => view.submit(cx),owner.pending,true));
}
function create(view,owner) {
  const readonly = owner.pending || owner.uncertain;
  const fields = [['revision','worktree_base','live-worktree-base'],['branch','worktree_branch','live-worktree-branch'],['path','worktree_path','live-worktree-path']];
  const form = new Form().size('large').gap_y(8).children(fields.map(([name,label,id]) => {
    const input = div().id(id).child(TextField.new(owner.fields[name],{readonly}));
    return new Field().label(view.text(label)).required(true).child(input);
  }));
  const content = div().v_flex().max_h(Math.max(120,window.viewport_size().height-200)).overflow_y_scroll().child(form);
  return div().id('live-worktree-form').v_flex().gap_4().child(content);
}
function managed(view,owner) {
  const readonly = owner.pending || !!owner.request;
  return div().id('location-create-form').v_flex().gap_4()
    .child(div().id(owner.pending || !owner.status ? 'location-branch-loading' : 'location-branch-name')
      .child(TextField.new(owner.fields.branch,{readonly})))
    .child(div().id('location-copy-changes').child(new Checkbox('location-copy-changes').size('small')
      .label(view.text('location_copy_changes')).checked(owner.include_changes).disabled(readonly)
      .on_change((value,cx) => {if (!readonly) {owner.include_changes = value; cx.notify();}})));
}
function removal(view,owner) {
  return div().id('worktree-remove-form').v_flex().gap_4()
    .child(div().text_sm().child(view.text('worktree_remove_named').replace('%{name}',owner.entry.path)));
}
function row(id,label,icon,checked,disabled,action,detail) {
  return new Button(id).ghost().w_full().accessibility_label(label).disabled(disabled).on_click(action)
    .child(div().h_flex().w_full().gap_2()
      .children(icon ? [new Icon(`icons/${icon}.svg`).size('small')] : [])
      .child(div().v_flex().flex_1().min_w_0().items_start()
        .child(div().truncate().child(label))
        .children(detail ? [div().text_xs().truncate().child(detail)] : []))
      .children(checked ? [new Icon('icons/check.svg').size('small')] : []));
}
function location(view) {
  const model = view.model, choices = model.choices(), state = model.location;
  const rows = choices.map((choice,index) => ({...choice,
    boundary:index > 0 && choice.group?.label !== choices[index-1].group?.label}));
  const selected = model.selected();
  return new List('location-choices',() => rows,choice => div().relative().w_full()
    .child(row(`location-${choice.id}`,choice.label.label,choice.icon,choice.id === selected,
      !choice.enabled || !state.can_move,(_,cx) => view.run(() => model.select(choice.id,state),cx)))
    .children(choice.boundary ? [div().absolute().top_0().w_full().child(new Separator())] : []))
    .w(300).h(Math.min(360,Math.max(40,choices.length*40)));
}
function management(view,owner) {
  const choices = owner.choices;
  return div().v_flex().gap_2()
    .children(owner.kind === 'actions' ? [
      button('worktree-back',view.text('location_back'),(_,cx) => {view.model.back();cx.notify();},owner.pending),
    ] : [])
    .child(new List(`worktree-list-${owner.kind}`,() => choices,choice => row(`worktree-${choice.id}`,
      choice.label,choice.icon,!!choice.checked,!!(owner.pending || choice.disabled),
      (_,cx) => view.run(() => view.model.choose(choice.id,{token:owner.token,choice}),cx),choice.detail))
      .w_full().h(Math.min(360,Math.max(40,choices.length*48))))
    .children(owner.loading && !choices.length ? [div().text_sm().child(view.text('git_loading'))] : [])
    .child(div().h_flex().justify_end().gap_2()
      .child(button('worktree-reload',view.text('worktree_retry'),(_,cx) => view.run(() => view.model.open(),cx),owner.pending || owner.loading))
      .child(button('worktree-close',view.text('close'),(_,cx) => view.close(cx))));
}
export function render(view) {
  const owner = view.model.dialog;
  const picking = owner && ['list','actions'].includes(owner.kind);
  const title = !owner ? '' : picking ? view.text('worktree_manage') : owner.kind === 'create' ? view.text('worktree_create') : owner.kind === 'managed'
    ? view.text(owner.fork ? 'location_fork' : 'location_create') : view.text('worktree_remove');
  const modal = Modal.new(owner?.token ?? 'worktree-dialog',{open:!!owner,form:true,title,
    width:owner?.kind === 'create' ? 488 : 448}).children(picking ? [management(view,owner)] : owner ? [
      owner.kind === 'create' ? create(view,owner) : owner.kind === 'managed' ? managed(view,owner) : removal(view,owner),
      footer(view,owner,owner.kind === 'create' ? 'live-worktree-submit' : owner.kind === 'managed' ? 'location-create-submit' : 'worktree-remove-confirm',
        owner.kind === 'create' ? 'live-worktree-cancel' : owner.kind === 'managed' ? 'location-cancel' : 'worktree-remove-cancel')
    ] : []);
  return div().id('worktrees-controller').children(view.model.menuOpen ? [location(view)] : []).child(modal);
}
