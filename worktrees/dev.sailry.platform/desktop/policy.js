// Worktree action policy adapted from Sailry ef5e82ea's native worktree manager.
export function label(entry, project) {
  return entry.main ? project : entry.branch || entry.head?.slice(0,8)
    || entry.path.split(/[\\/]/).filter(Boolean).at(-1) || entry.path;
}
export function registered(catalog, location, text) {
  const entries = catalog.worktrees.map(tree => ({...tree,branch:tree.id === location.worktree ? location.branch : null,
    head:null,locked:false,available:true}));
  return listing(catalog,{kind:'repository',entries},{...location,surface:'project'},text);
}
export function navigationLabel(value) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
    || !value.replace(/[\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/gu,'')) return undefined;
  return byteLength(value)<=128 ? {label:value} : undefined;
}
export function byteLength(value) {
  let bytes=0;
  for (const character of value) {
    const code=character.codePointAt(0);
    bytes += code<=0x7f ? 1 : code<=0x7ff ? 2 : code<=0xffff ? 3 : 4;
  }
  return bytes;
}
export function menu(location,catalog,entries,text) {
  const choice = (id,name,icon,group,enabled=true) => ({
    id,label:navigationLabel(name) ?? {label:text('workspace_worktrees')},icon,
    group:{label:text(group)},enabled,
  });
  if (!location.project) {
    if (!location.can_retarget) return [];
    return [
      choice('unassigned',text('composer_no_project'),undefined,'location_project'),
      ...location.projects.map(project => choice(`project:${project.id}`,project.name,'folder','location_project')),
      choice('add_project',text('location_add_project'),'plus','workspace_session_actions'),
    ];
  }
  const choices = [...(catalog?.worktrees ?? [])].sort((left,right) => Number(right.main)-Number(left.main)).map(tree => {
    const entry = entries?.find(entry => entry.path === tree.path);
    const branch = tree.id === location.worktree ? location.branch : entry?.branch;
    const name = tree.main
      ? `${text('location_main')}${branch ? ` (${branch})` : ''}`
      : label({...tree,branch,head:entry?.head},location.project_name);
    return choice(`worktree:${tree.id}`,name,tree.main ? 'folder' : 'network','workspace_worktrees',entry?.available !== false);
  });
  if (location.git) {
    choices.push(choice('create',text('location_create'),'plus','workspace_session_actions'));
    if (location.session) choices.push(choice('fork',text('location_fork'),'plus','workspace_session_actions'));
  }
  choices.push(choice('manage',text('worktree_manage'),'network','workspace_session_actions'));
  choices.push(choice('projects',text('location_project'),'folder','location_project',!!location.can_retarget));
  return choices;
}
export function listing(catalog, found, location, text) {
  const project = catalog.projects.find(project => project.id === location.project);
  const entries = [...found.entries];
  const git = found.kind !== 'directory';
  if (!git) entries.push(...catalog.worktrees.filter(tree => tree.main).map(tree => ({...tree,branch:null,head:null,locked:false,available:true})));
  const choices = entries.map((entry,index) => {
    const registered = catalog.worktrees.find(tree => tree.path === entry.path);
    const prune = !entry.available && !entry.main && !entry.locked;
    const actions = [];
    if (entry.available) actions.push({kind:'open',entry,worktree:registered?.id});
    if (entry.available && !entry.main && !entry.locked && entry.branch && entry.head) actions.push({kind:'remove',entry,worktree:registered?.id});
    return {id:`entry-${index}`,label:label(entry,project?.name ?? location.project_name),
      icon:entry.main ? 'folder' : 'network',group:text('workspace_worktrees'),
      checked:registered?.id === location.worktree,
      detail:prune ? text('worktree_prune_on_select') : !entry.available ? text('worktree_unavailable')
        : entry.locked ? text('worktree_locked') : entry.main ? entry.branch ?? '' : project?.name ?? location.project_name,
      disabled:!prune && actions.length === 0,
      action:prune ? {kind:'prune',entry} : {kind:'actions',entry,actions}};
  });
  if (location.surface === 'composer') {
    if (git) {
      choices.push({id:'create',label:text('location_create'),icon:'plus',group:text('workspace_session_actions'),action:{kind:'managed',fork:false}});
      if (location.session) choices.push({id:'fork',label:text('location_fork'),icon:'plus',group:text('workspace_session_actions'),action:{kind:'managed',fork:true}});
    }
    if (!location.session) choices.push({id:'projects',label:text('location_project'),group:text('workspace_session_actions'),action:{kind:'projects'}});
  } else if (entries.some(entry => entry.available && entry.head)) {
    const base = entries.find(entry => catalog.worktrees.some(tree => tree.id === location.worktree && tree.path === entry.path)) ?? entries.find(entry => entry.available && entry.head);
    choices.push({id:'create',label:text('worktree_create'),icon:'plus',group:text('worktree_actions'),action:{kind:'create',entry:base}});
  }
  if (found.truncated || Number(found.omitted_paths) > 0) choices.push({id:'partial',label:text('worktree_listing_partial'),disabled:true,action:null});
  return choices;
}
export function errorKey(code, removal = false) {
  if (removal && code === 'busy') return 'worktree_remove_busy';
  if (removal && ['conflict','revision_conflict'].includes(code)) return 'worktree_remove_conflict';
  return ({outcome_unknown:'worktree_outcome_unknown',conflict:'worktree_conflict',revision_conflict:'worktree_conflict',invalid_request:'worktree_invalid',not_found:'worktree_not_found'})[code] ?? 'worktree_request_failed';
}
export function current(bound, state) {
  return bound.cursor === state.cursor && bound.node === state.node && bound.project === state.project
    && bound.worktree === state.worktree && bound.session === state.session && state.can_move;
}
