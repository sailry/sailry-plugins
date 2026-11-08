import {div} from 'gpui-kit';
import {Menu} from 'sailry/ui';

export function render(view,dialogs) {
  const choices = view.branchChoices();
  const items = [
    ...(view.branchPath.length ? [{id:'back',label:view.text.git_back,icon:'arrow-left',enabled:true}] : []),
    ...choices.flatMap((choice,index) => [
      ...(choice.group && choice.group !== choices[index-1]?.group ? [{header:true,label:choice.group}] : []),
      {id:`choice:${index}`,label:choice.label,icon:choice.icon ?? 'network',checked:!!choice.checked,
        enabled:!choice.disabled && view.repo.writable() && view.location.can_move,value:choice},
    ]),
  ];
  const content = Menu.new('git-branch-choices',{content:true,label:view.text.git_manage_branches,items});
  return div().children(view.menuOpen ? [content] : []).child(dialogs);
}
