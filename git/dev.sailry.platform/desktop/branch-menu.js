import {div} from 'gpui-kit';
import {Button,Icon,List,Separator} from 'gpui-component';

export function render(view,dialogs) {
  const choices = view.branchChoices();
  const rows = choices.flatMap((choice,index) => [
    ...(choice.group && choice.group !== choices[index-1]?.group
      ? [{id:`group:${index}`,heading:choice.group}] : []),choice,
  ]);
  const content = div().v_flex().w(300).gap_1()
    .children(view.branchPath.length ? [
      new Button('git-branch-back').ghost().label(view.text.git_back)
        .on_click((_,cx) => {view.back();cx.notify();}),
    ] : [])
    .child(new List('git-branch-choices',() => rows,choice => choice.heading
      ? div().h_8().w_full().v_flex().justify_center().child(new Separator().label(choice.heading))
      : new Button(`git-branch-${choice.id}`).ghost().w_full().h_8().accessibility_label(choice.label)
        .disabled(!!choice.disabled || !view.repo.writable() || !view.location.can_move)
        .on_click((_,cx) => view.run(() => view.selectBranch(choice),cx))
        .child(div().h_flex().w_full().gap_2()
          .child(new Icon(`icons/${choice.icon ?? 'network'}.svg`).size('small'))
          .child(div().flex_1().min_w_0().truncate().child(choice.label))
          .children(choice.checked ? [new Icon('icons/check.svg').size('small')] : [])))
      .w_full().h(Math.min(360,Math.max(40,rows.length*40))));
  return div().children(view.menuOpen ? [content] : []).child(dialogs);
}
