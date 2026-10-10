import {div} from 'gpui-kit';
import {PanelHeader,SelectField,Menu,IconButton,Loading} from 'sailry/ui';
import {ArtifactSurface} from 'sailry/artifacts';

export function render(view) {
  const {state,text} = view,disabled = !state.connected || state.loading;
  const header = PanelHeader.new('brief-header',{padding:8,bordered:true})
    .child(div().text_sm().font_semibold().truncate().flex_1().min_w_0().child(state.artifact?.title ?? ''))
    .child(div().w_24().flex_shrink(0).child(SelectField.new('brief-version',{
      label:text.brief_version,placeholder:text.brief_version,selected:state.revision === null ? null : String(state.revision),
      disabled:disabled || !state.artifact,items:state.versions(),
    })))
    .children(state.before === null ? [] : [IconButton.new('brief-more-versions',{
      icon:'ellipsis',label:text.brief_more_versions,disabled,
    })])
    .child(Menu.new('brief-export',{label:text.brief_export,icon:'ellipsis-vertical',
      disabled:disabled || state.exporting || !state.artifact,
      items:[{id:'brief-export-html',label:text.brief_html,value:{format:'html'}},
        {id:'brief-export-image',label:text.brief_image,value:{format:'png'}}]}));
  const content = state.artifact ? ArtifactSurface.new(`brief-preview-${state.artifact.id}`,{
    artifact:state.artifact.id,...(state.follow ? {} : {revision:state.artifact.revision}),
    labels:{contents:text.brief_contents,submit:text.brief_submit,zoom_in:text.brief_zoom_in,
      zoom_out:text.brief_zoom_out,close:text.brief_close,required:text.brief_form_required,
      invalid_form:text.brief_form_invalid,render_error:text.brief_render_failed},
  }) : state.loading ? Loading.new('brief-loading')
    : div().size_full().h_flex().justify_center().items_center().child(IconButton.new('brief-retry',{
      icon:'rotate-cw',label:text.brief_retry,disabled:!state.resource || !state.connected,show_label:true,
    }));
  return div().id('brief-panel').v_flex().size_full().min_w_0().min_h_0().child(header)
    .child(div().flex_1().min_w_0().min_h_0().child(content));
}
