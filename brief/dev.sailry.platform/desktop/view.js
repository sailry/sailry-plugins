import {div} from 'gpui-kit';
import {Header} from 'sailry';
import {Picker,IconButton,Loading} from 'sailry/ui';
import {ArtifactSurface} from 'sailry/artifacts';

export function render(view) {
  const {state,text} = view,disabled = !state.connected || state.loading;
  const header = Header.new('brief-header',{content:JSON.stringify({title:state.artifact?.title ?? '',
    filters:[{id:'brief-version',label:text.brief_version,selected:state.revision === null ? '' : String(state.revision),
      primary:true,disabled:disabled || !state.artifact,items:state.versions()}],
    actions:[...(state.before === null ? [] : [{id:'brief-more-versions',icon:'icons/ellipsis.svg',label:text.brief_more_versions,disabled}]),
      {id:'brief-export',label:text.brief_export,icon:'icons/ellipsis-vertical.svg',disabled:disabled || state.exporting || !state.artifact}],
  })});
  const content = state.artifact ? ArtifactSurface.new(`brief-preview-${state.artifact.id}`,{
    artifact:state.artifact.id,...(state.follow ? {} : {revision:state.revision}),
    labels:{contents:text.brief_contents,submit:text.brief_submit,required:text.brief_form_required,
      invalid_form:text.brief_form_invalid,render_error:text.brief_render_failed},
  }) : state.loading ? Loading.new('brief-loading')
    : div().size_full().h_flex().justify_center().items_center().child(IconButton.new('brief-retry',{
      icon:'rotate-cw',label:text.brief_retry,disabled:!state.resource || !state.connected,show_label:true,
    }));
  return div().id('brief-panel').v_flex().size_full().min_w_0().min_h_0().child(header)
    .child(div().flex_1().min_w_0().min_h_0().child(content))
    .child(Picker.new('brief-export-picker',{mode:'command',open:view.exportOpen === true,title:text.brief_export,
      items:[{id:'brief-export-html',label:text.brief_html,disabled,value:{format:'html'}},
        {id:'brief-export-image',label:text.brief_image,disabled,value:{format:'png'}}]}));
}
