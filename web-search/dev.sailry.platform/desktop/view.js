import {div} from 'gpui-kit';
import {Button,Switch,Field,Form} from 'gpui-component';
import {theme} from 'sailry';
import {TextField} from 'sailry/forms';
import {SecretField} from 'sailry/credentials';
import {SettingsGroup,SelectField,IconButton,Modal} from 'sailry/ui';
import * as catalog from './catalog.js';

function button(id,label,action,disabled=false) {
  return div().id(id).child(new Button(id).label(label).disabled(disabled).on_click(action));
}
function row(id,label,control) {
  return div().id(id).h_flex().w_full().items_center().py_3().gap_4().text_sm()
    .child(div().flex_1().min_w_0().child(label))
    .child(div().w_64().max_w_full().h_flex().justify_end().child(control));
}
function toggle(id,value,locked,action) {
  return div().id(id).child(new Switch(id).checked(!!value).disabled(locked).on_change(action));
}
function editor(view) {
  const owner=view.editor,text=view.text,locked=view.loading||view.pending||!!view.request;
  let modal=Modal.new(owner?.id??'search-dialog',{open:!!owner,form:true,width:540,
    title:owner?text[`search_driver_${owner.driver}`]:'',dismissable:!locked});
  if(!owner)return modal;
  const form=new Form().size('large').gap_y(8);
  if(owner.driver==='model') {
    form.child(new Field().label(text.search_model_provider).child(SelectField.new('search-model-provider',{
      label:text.search_model_provider,disabled:locked,selected:owner.model?.provider ?? '',items:catalog.providers(view.models)})));
    form.child(new Field().label(text.search_model_name).child(SelectField.new('search-model-name',{
      label:text.search_model_name,disabled:locked||!owner.model?.provider,selected:owner.model?.model ?? '',
      items:view.models.filter(model=>model.provider===owner.model?.provider).map(model=>({id:model.model,label:model.model}))})));
  } else {
    if(owner.driver==='searxng')form.child(new Field().label(text.search_endpoint)
      .child(div().id('search-editor-endpoint').child(TextField.new(owner.endpoint,{readonly:locked}))));
    form.child(new Field().label(text.search_api_key).child(div().id('search-editor-key').child(SecretField.new(owner.key,{disabled:locked}))))
      .child(new Field().label(text.search_remove_key).child(toggle('search-editor-clear-key',owner.removeKey,locked,(value,cx)=>{
        owner.removeKey=value;cx.notify();
      })));
    if(owner.driver==='searxng') {
      for(const key of ['username','password'])form.child(new Field().label(text[`search_${key}`])
        .child(div().id(`search-editor-${key}`).child(SecretField.new(owner[key],{disabled:locked}))));
      form.child(new Field().label(text.search_remove_basic).child(toggle('search-editor-clear-basic',owner.removeBasic,locked,(value,cx)=>{
        owner.removeBasic=value;cx.notify();
      })));
    }
  }
  return modal.child(div().id('search-editor').child(form))
    .child(div().h_flex().justify_end().gap_2()
      .children(view.saved?.revision!==owner.settings.revision
        ? [button('search-editor-reload',text.search_reload,(_,cx)=>view.reloadEditor(cx),locked)] : [])
      .child(button('search-editor-cancel',text.settings_cancel,(_,cx)=>view.close(cx),locked))
      .child(button('search-editor-save',text[view.request?'search_retry':'settings_save'],(_,cx)=>view.saveEditor(cx),view.loading||view.pending)));
}
export function render(view) {
  const text=view.text,settings=view.saved??{providers:{}},locked=view.busy(),drivers=view.available();
  const selected=settings.driver?.kind==='driver'?settings.driver.driver:settings.driver?.kind??'none';
  const providers=drivers.map(driver=>{
    const config=settings.providers[driver]??{},capability=settings.capabilities?.[driver];
    const status=!config.enabled?'search_disabled':catalog.needsKey(capability)&&!config.key_configured
      ?'search_key_required':driver==='searxng'&&!config.endpoint?'search_endpoint_required'
      :driver==='model'&&!catalog.contains(view.models,config.model)?'search_model_required':'search_configured';
    return div().id(`search-driver-${driver}`).h_flex().w_full().py_3().items_center().gap_4()
      .child(div().flex_1().min_w_0().v_flex().gap_1().child(text[`search_driver_${driver}`])
        .child(div().text_sm().text_color(theme().colors.muted_foreground).child(text[status]))
        .children(capability?.quota?[div().text_sm().text_color(theme().colors.muted_foreground).child(text[`search_quota_${capability.quota}`])]:[]))
      .child(toggle(`search-enabled-${driver}`,config.enabled,locked,(value,cx)=>view.enabled(driver,value,cx)))
      .child(IconButton.new(`search-edit-${driver}`,{icon:'settings-2',label:text.settings_edit,disabled:locked}))
      .child(IconButton.new(`search-test-${driver}`,{icon:'play',label:text.search_test,disabled:locked}));
  });
  return div().id('search-settings').v_flex().gap_6()
    .children(!view.saved&&!view.loading?[button('search-reload',text.search_reload,(_,cx)=>view.load(cx))]:[])
    .children(view.request&&!view.editor?[button('search-retry',text.search_retry,(_,cx)=>view.retry(cx),view.pending)]:[])
    .child(SettingsGroup.new('search_settings',{title:text.search_settings})
      .child(row('search-driver-row',text.search_default_driver,SelectField.new('search-default-driver',{
        label:text.search_default_driver,disabled:locked,selected,items:['auto',...drivers,'none'].map(id=>({id,label:text[`search_driver_${id}`]}))})))
      .child(row('search-fallback',text.search_fallback,toggle('search-fallback-toggle',settings.fallback,locked||selected==='model',
        (value,cx)=>view.toggle('fallback',value,cx)))))
    .child(SettingsGroup.new('search_providers',{title:text.search_providers}).children(providers))
    .child(editor(view));
}
