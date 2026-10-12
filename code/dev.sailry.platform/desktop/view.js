// Kit composition preserves the flat language list and shared dialog layout.
import {div} from 'gpui-kit';
import {Button,Switch,Field,Form} from 'gpui-component';
import {theme} from 'sailry';
import {TextField} from 'sailry/forms';
import {SettingsGroup,SegmentedTabs,IconButton,EmptyState,Modal} from 'sailry/ui';
import {installed,installing,available} from './model.js';

function button(id,label,action,disabled=false) {
  return div().id(id).child(new Button(id).label(label).disabled(disabled).on_click(action));
}
function row(id,label,value) {
  return div().id(id).h_flex().w_full().items_center().py_3().gap_4().text_sm()
    .child(div().flex_1().min_w_0().child(label))
    .child(div().max_w_96().min_w_0().child(value));
}
function server(view,item) {
  const text=view.text,locked=view.busy(),name=item.server;
  const controls=div().id(`code-server-${name}-actions`).h_flex().w(120).flex_shrink(0).justify_end().items_center().gap_2();
  controls.child(IconButton.new(`code-details-${name}`,{icon:'info',label:text.code_details}));
  let toggle=[];
  if (installed(item) && item.candidate) {
    toggle=[div().id(`code-enabled-${name}`).child(new Switch(`code-enabled-${name}`)
      .checked(!(view.saved.servers[name]?.disabled ?? item.candidate.disabled)).disabled(locked)
      .on_change((enabled,cx)=>view.toggle(name,enabled,cx)))];
    controls.child(IconButton.new(`code-edit-${name}`,{icon:'settings-2',label:text.code_configure,disabled:locked}));
  } else if (!installed(item)) {
    controls.child(IconButton.new(`code-install-${name}`,{icon:'arrow-down',label:text.code_install,
      disabled:locked || installing(item) || !item.candidate?.package?.install}));
    if (installing(item)) controls.child(IconButton.new(`code-cancel-${name}`,
      {icon:'circle-x',label:text.code_cancel_install,disabled:false}));
  }
  return div().id(`code-server-${name}`).h_flex().w_full().py_3().items_center().gap_4()
    .child(div().id(`code-server-${name}-content`).v_flex().gap_1().flex_1().min_w_0()
      .child(div().truncate().child(name))
      .child(div().text_sm().text_color(theme().colors.muted_foreground).truncate().child(item.languages.join(', ')))
      .children(item.installation?.progress ? [div().text_sm().child(item.installation.progress)] : []))
    .children(toggle).child(controls);
}
function dialog(view) {
  const owner=view.dialog,text=view.text;
  let modal=Modal.new(owner?.id ?? 'code-dialog',{open:!!owner,form:true,
    title:owner?.kind==='edit' ? text.code_custom_command : owner?.kind==='details' ? owner.row.server
      : text[owner?.kind==='uninstall' ? 'code_uninstall' : 'code_install'],width:600,dismissable:!view.pending && !view.request && view.clean()});
  if (!owner) return modal;
  const item=view.rows().find(item=>item.server===owner.row.server) ?? owner.row;
  const receipt=owner.row.installation?.receipt;
  const footer=div().h_flex().w_full().justify_end().gap_2()
    .child(button(owner.kind==='edit'?'code-editor-close':'code-details-close',text[owner.kind==='edit'?'close':'settings_cancel'],(_,cx)=>view.close(cx),view.pending));
  if (owner.kind==='edit') {
    if (owner.blocked) footer.child(button('code-editor-reload',text.code_reload,(_,cx)=>view.reloadEditor(cx),view.busy()));
    const keys=['code_command','code_arguments','code_configuration','code_environment'];
    return modal.child(div().id('code-command-editor').child(new Form().children(owner.fields.map((field,index)=>
      new Field().label(text[keys[index]]).child(div().id(`code-command-${index}`)
        .child(TextField.new(field,{readonly:view.pending}))))))).child(footer);
  }
  if (owner.kind==='details') {
    const pkg=item.candidate?.package,install=pkg?.install,received=item.installation?.receipt;
    const version=received?.version && install?.version && received.version !== install.version
      ? `${received.version} → ${install.version}` : install?.version ?? received?.version ?? pkg?.version;
    const details=[['server',item.server],['command',item.candidate?.command],
      ['package',install?.package ?? pkg?.name ?? received?.package],['version',version],
      ['source',install?.purl ?? received?.purl ?? pkg?.homepage],['downloads',install?.urls?.join('\n')],
      ['licenses',(install?.licenses ?? pkg?.licenses)?.join(', ')]];
    if (installing(item)) footer.child(button('code-details-cancel-install',text.code_cancel_install,
      (_,cx)=>view.cancel(item.installation.package,cx)));
    else if (installed(item)) {
      footer.child(button('code-details-update',text.code_update,(_,cx)=>view.install(item,cx),
        view.busy() || !pkg?.install || received?.version===pkg.install.version));
      if (received) footer.child(button('code-details-uninstall',text.code_uninstall,
        (_,cx)=>view.confirm('uninstall',item,cx),view.busy()));
    } else footer.child(button('code-details-install',text.code_install,
      (_,cx)=>view.install(item,cx),view.busy() || !pkg?.install));
    return modal.child(div().id('code-server-details').v_flex().gap_4()
      .children(item.languages.length ? [div().id('code-server-description').text_sm()
        .text_color(theme().colors.muted_foreground).child(text.code_server_description.replace('%{languages}',item.languages.join(', ')))] : [])
      .child(SettingsGroup.new('code_information',{heading:false,variant:'outline'}).children(details.filter(([,value])=>value)
        .map(([key,value])=>row(`code-detail-${key}`,text[`code_${key}`],value))))).child(footer);
  }
  const details=[['package',receipt.package],['version',receipt.version]];
  footer.child(button('code-consent-submit',text.code_uninstall,(_,cx)=>{
    const command={kind:'uninstall_code_server',data:{package:receipt.package,version:receipt.version}};
    view.close(cx); view.submit(command,cx);
  },view.busy()));
  return modal.child(div().id('code-consent-details').v_flex().gap_3().children(details.map(([key,value])=>
    div().v_flex().gap_1().child(div().text_sm().text_color(theme().colors.muted_foreground).child(text[`code_${key}`]))
      .child(div().id(`code-consent-code_${key}`).child(value))))).child(footer);
}
export function render(view) {
  const text=view.text,items=view.rows().filter(view.tab==='installed' ? installed : available);
  return div().id('code-settings').v_flex().gap_6()
    .children(!view.ready && !view.loading ? [button('code-reload',text.code_retry,(_,cx)=>view.load(cx))] : [])
    .children(view.request ? [button('code-retry',text.code_retry,(_,cx)=>view.retry(cx),view.pending)] : [])
    .child(SettingsGroup.new('code_settings',{title:text.code_settings,header_action:true})
      .child(button('code-update-rules',text.code_update_rules,(_,cx)=>view.submit({kind:'update_code_rules'},cx),view.busy()))
      .child(row('settings-row-code_rules_updated',text.code_rules_updated,view.rules?.retrieved ?? '')))
    .child(div().v_flex().gap_4()
      .child(div().id('code-server-toolbar').w(220).child(SegmentedTabs.new('code-tabs',{selected:view.tab,
        items:[{id:'installed',label:text.code_installed},{id:'available',label:text.code_not_installed}]})))
      .child(SettingsGroup.new('code_languages',{heading:false}).children(items.length ? items.map(item=>server(view,item))
        : view.ready ? [EmptyState.new('code-empty',{icon:'cpu',variant:'list',label:text[view.tab==='installed'
          ? 'code_installations_empty':'code_languages_empty']})] : [])))
    .child(dialog(view));
}
