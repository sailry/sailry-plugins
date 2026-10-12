import {Button} from 'gpui-component';
import {StatusList} from 'sailry/ui';

export function render(view) {
  const {text, goal} = view;
  const disabled = view.busy || view.loading || !view.state.connected || view.state.readonly;
  const resumable = goal && ['paused','blocked','failed'].includes(goal.state);
  const description=goal?.description ?? view.draft() ?? '';
  return StatusList.new('goal-description',{items:[],empty:text.empty,...(description ? {body:description} : {})})
      .children(view.pending ? [new Button('goal-retry').size('small').label(text.retry).disabled(view.busy || view.loading)
        .on_click((_,cx) => view.execute(cx))] : [])
      .children(goal?.state === 'active' ? [new Button('goal-stop').size('small').label(text.stop).disabled(disabled || !!view.pending)
        .on_click((_,cx) => view.perform('pause',cx))] : [])
      .children(resumable ? [new Button('goal-resume').size('small').label(text.resume).disabled(disabled || !!view.pending || view.state.mode === 'plan')
        .on_click((_,cx) => view.perform('resume',cx))] : [])
      .children(goal ? [new Button('goal-clear').size('small').ghost().label(text.clear).disabled(disabled || !!view.pending)
        .on_click((_,cx) => view.perform('clear',cx))] : []);
}
