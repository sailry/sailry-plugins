// Existing role records and forms composed with the same native Kit controls.
import {div} from 'gpui-kit';
import {Button,Checkbox,Field,Form} from 'gpui-component';
import {theme} from 'sailry';
import {TextField,SliderField} from 'sailry/forms';
import {EmptyState,SettingsGroup,SettingsRow,IconButton,Appearance,AppearancePicker,Menu,Modal,Loading} from 'sailry/ui';
import {efforts,PRESETS} from './draft.js';

function button(id,label,action,disabled = false,primary = false) {
  let control = new Button(id).label(label).disabled(disabled).on_click(action);
  if (primary) control = control.primary();
  return div().id(id).child(control);
}
function choice(owner,value,label,checked) {
  return {id:`${owner.token}:${value}`,label,enabled:true,checked};
}
function effortLabel(view,value) {
  if (value === null) return view.text.role_effort_inherit;
  if (typeof value === 'object') return String(value.budget);
  return value;
}
function empty(view) {
  return EmptyState.new('role-empty',{variant:'list',icon:'inbox',label:view.text.settings_empty});
}
function editor(view,owner) {
  const text = view.text, locked = !!owner.request, props = {readonly:locked};
  const source = Menu.new('role-source',{label:text[owner.fixed ? 'role_fixed' : 'role_inherit'],form:true,disabled:locked,
    items:[choice(owner,'inherit',text.role_inherit,!owner.fixed),choice(owner,'fixed',text.role_fixed,owner.fixed)]});
  const model = Menu.new('role-model',{label:owner.model?.model ?? text.media_unconfigured,form:true,disabled:locked,
    items:owner.models.map(model => choice(owner,model.id,`${model.provider} / ${model.model}`,
      model.id === `${owner.model?.provider}/${owner.model?.model}`))});
  const effort = Menu.new('role-effort',{label:effortLabel(view,owner.model?.effort ?? null),form:true,disabled:locked,
    items:efforts(owner).map(value => choice(owner,JSON.stringify(value),effortLabel(view,value),
      JSON.stringify(value) === JSON.stringify(owner.model?.effort === 'default' ? null : owner.model?.effort ?? null)))});
  const field = (label,control) => new Form().gap_y(6).child(new Field().label(label).child(control));
  const pair = (left,right) => div().h_flex().w_full().gap_4().items_start()
    .child(div().flex_1().min_w_0().child(left)).child(div().flex_1().min_w_0().child(right));
  const presets = Menu.new('role-presets',{label:text.role_presets,form:owner.creating,small:!owner.creating,disabled:locked,
    items:Object.keys(PRESETS).map(key => choice(owner,key,text[`role_preset_${key}`],false))});
  const name = TextField.new(owner.fields.name,{...props,adornment:'prefix'})
    .child(AppearancePicker.new('role',{label:text.role_appearance,value:owner.appearance,disabled:locked}));
  const readOnly = div().id('role-read-only').child(new Checkbox('role-read-only-toggle')
    .label(text.role_read_only).checked(owner.readOnly).disabled(locked)
    .on_change((checked,cx) => {
      if (owner.request) return;
      owner.readOnly = checked; owner.error = null; cx.notify();
    }));
  const instructions = div().v_flex().gap_2()
    .child(div().h_flex().w_full().justify_between().gap_2().text_sm().font_medium()
      .child(text.role_instructions)
      .children(owner.creating ? [] : [presets]))
    .child(div().id('role-instructions').child(TextField.new(owner.fields.instructions,props)));
  return div().id('role-editor').v_flex().gap_4().p_1()
    // A new subagent can start from a complete preset role.
    .children(owner.creating ? [field(text.role_presets,presets)] : [])
    .child(pair(field(text.settings_name,div().id('role-field-settings_name').child(name)),
      field(text.role_id,div().id('role-field-role_id').child(TextField.new(owner.fields.key,props)))))
    .child(pair(field(text.role_model_source,source),field(text.provider_default_effort,effort)))
    .children(owner.fixed ? [field(text.provider_models,model)] : [])
    .child(field(text.role_max_turns,div().id('role-max-turns').child(TextField.new(owner.fields.turns,props))))
    .child(readOnly)
    .child(instructions);
}
function removal(view,owner) {
  const text = view.text;
  return div().id('role-removal').v_flex().gap_4()
    .child(div().text_sm().child(text.role_remove_live.replace('%{name}',owner.original.name)));
}
function footer(view,owner) {
  const text = view.text, removal = owner.kind !== 'edit';
  return div().h_flex().justify_end().gap_2()
    .child(button(removal ? 'role-delete-cancel' : 'role-cancel',text.settings_cancel,(_,cx) => view.close(cx)))
    .child(button(removal ? 'role-delete-confirm' : 'role-save',text[owner.request ? 'role_retry' : removal ? 'settings_delete' : 'role_save'],
      (_,cx) => view.save(cx),owner.pending || !view.connected,true));
}
export function render(view) {
  const text = view.text, disabled = !view.ready || !view.connected;
  const rows = view.roles.map(role => div().id(`role-${role.id}`).w_full().text_sm().py_3()
    .child(div().h_flex().w_full().items_center().gap_3()
      .child(Appearance.new(`role-appearance-${role.id}`,{value:role.appearance ?? {icon:'ai',color:'none'}}))
      .child(div().flex_1().min_w_0().v_flex().gap_0p5().child(div().truncate().child(role.name))
        .child(div().text_xs().text_color(theme().colors.muted_foreground).truncate()
          .child(role.description || `@${role.key}`)))
      .child(div().h_flex().flex_shrink(0).gap_1()
        .child(IconButton.new(`role-edit-${role.id}`,{icon:'settings-2',label:text.settings_edit,disabled}))
        .child(IconButton.new(`role-delete-${role.id}`,{icon:'trash-2',label:text.settings_delete,disabled})))));
  const control = new Button('role-add').outline().size('small').label(text.settings_add).disabled(disabled)
    .on_click((_,cx) => view.edit(null,cx));
  const add = div().id('role-add').child(control);
  const owner = view.dialog, editing = owner?.kind === 'edit';
  const title = editing ? text[owner.creating ? 'role_create' : 'role_editor'] : owner ? text.settings_delete : '';
  const modal = Modal.new(owner?.token ?? 'role-dialog',{open:!!owner,form:true,title,width:editing ? 560 : 448})
    .children(owner ? [editing ? editor(view,owner) : removal(view,owner),footer(view,owner)] : []);
  return div().id('role-settings').v_flex().gap_6()
    .children(view.capacity ? [SettingsGroup.new('execution_settings',{title:text.execution_settings})
      .child(SettingsRow.new('capacity-row',{label:text.child_concurrency})
        .child(div().h_flex().items_center().gap_2()
          .child(div().w_40().child(SliderField.new(view.capacity.field,
            {disabled:view.capacity.locked()})))
          .child(div().min_w_8().text_sm().child(view.capacity.value ?? ''))
          .children(view.capacity.request && view.capacity.unknown ? [button('capacity-retry',text.role_retry,
            (_,cx)=>view.capacity.save(cx),view.capacity.pending || !view.connected)] : [])))] : [])
    .child(SettingsGroup.new('roles_profiles',{title:text.roles_profiles,header_action:true})
      .child(div().h_flex().gap_2().flex_wrap()
        .child(add))
      .children(rows.length ? rows : view.ready ? [empty(view)] : [view.error && !view.loading
        ? button('role-reload',text.role_retry,(_,cx)=>view.load(cx,true),!view.connected)
        : div().relative().w_full().h_24().child(Loading.new('role-loading'))]))
    .child(modal);
}
