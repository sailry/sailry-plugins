import {div} from 'gpui-kit';
import {readLocation,nextLocationChange,selectLocation,invokeContribution,writeClipboard,openResource} from 'sailry/ui';
import {context as readScope,publishContributions,nextContributionEvent,readWorktreeCatalog,listWorktrees,listGitBranches,
  inspectGit,newId} from 'sailry/sdk';
import Git from './main.js';
import {dialogs} from './view.js';
import {branchMenu,checkouts,label,resolve} from './session-branch.js';

export default class Context extends Git {
  init(props,cx) {
    this.overlay = true;
    this.worktree = readScope().worktree;
    this.location = readLocation();
    this.node = this.location?.node;
    this.checkouts = new Map(); this.branches = null;
    super.init(props,cx);
    this.publish();
    cx.spawn(async () => this.sync());
    cx.spawn(async cx => {
      try { while (true) {
        const previous = this.location;
        this.location = await nextLocationChange(previous.cursor);
        this.publish();
        if (['node','worktree','session','branch','git_status'].some(key => this.location[key] !== previous[key]))
          this.sync();
        cx.notify();
      } } catch (_) { /* The controller retains its original checkout. */ }
    });
    cx.spawn(async cx => {
      try { while (true) {
        const event = await nextContributionEvent();
        this.publish(event);
        if (!this.sameScope()) { cx.notify(); continue; }
        this.run(async () => {
          if (event.id === 'branch') {
            if (event.kind === 'change' && typeof event.value === 'string') await this.choose(event.value);
          } else if (event.id === 'changes') await openResource('git',{path:null});
          else await this.openPicker(event.id);
        },cx);
      } } catch (_) { /* Disabling the package releases contribution events. */ }
    });
  }
  /** Lists branches and other checkouts so the chip has rows before it opens.
   * Status stays with the Node, so the composer reads only references. */
  async sync() {
    const state = this.location;
    if (state?.surface !== 'composer' || !this.sameScope() || state.git_status !== 'repository') return;
    try {
      const branches = await listGitBranches();
      if (this.location !== state && this.location.worktree !== state.worktree) return;
      this.branches = branches?.entries ?? null;
      if (!state.session) {
        const [catalog,found] = await Promise.all([readWorktreeCatalog(),listWorktrees()]);
        this.checkouts = checkouts(catalog,found?.entries,this.worktree);
      }
    } catch (_) { /* The chip keeps its last rows; selection revalidates against them. */ }
    this.publish(); this.notify?.();
  }
  entries() { return this.branches ?? this.repo?.branches?.entries ?? null; }
  async choose(id) {
    const state = this.location;
    if (!state.can_move) return;
    const action = resolve(id,state,this.entries(),this.checkouts,newId);
    if (!action) { this.report('git_branch_revision'); return; }
    if (action.kind === 'stay') { if (state.base) await selectLocation(state.cursor,{worktree:state.worktree}); }
    else if (action.kind === 'worktree') await selectLocation(state.cursor,{worktree:action.worktree});
    else if (action.kind === 'base') await selectLocation(state.cursor,{base:action.base});
    else if (action.kind === 'start') this.actions.form('start');
    else if (action.kind === 'copy') writeClipboard(action.text);
    else if (action.kind === 'fork') await invokeContribution('fork_worktree',{base:action.base});
  }
  /** Starts the new conversation on a named branch from the bound checkout's HEAD. */
  async startBranch(name) {
    const state = this.location;
    if (!this.sameScope() || state.session || !state.can_move) return;
    const head = (await inspectGit())?.head;
    if (!head) { this.report('worktree_commit_first'); return; }
    await selectLocation(state.cursor,{base:{from:name,branch:name,commit:head}});
  }
  async openPicker(kind) {
    if (this.actions.picker?.loading && this.actions.picker.contribution === kind) return;
    const picker = this.actions.choose('git_manage_branches',[]);
    picker.contribution = kind; picker.loading = true; this.notify();
    let ready = false;
    try { ready = await this.repo.refresh(); }
    finally {
      if (this.actions.picker === picker) {
        if (ready && this.sameScope()) this.actions.update(picker,this.menus.management());
        else { this.actions.picker = null; this.notify(); }
      }
    }
  }
  sameScope() {
    return !!this.worktree && this.location?.node === this.node
      && this.location?.worktree === this.worktree && this.location.connected !== false
      && this.repo?.connected !== false && !this.repo?.closed;
  }
  async invalidate() {
    if (this.location.surface === 'composer') return;
    if (this.sameScope()) await super.invalidate();
    this.publish();
  }
  publish(event) {
    const state = this.location;
    if (!state) return;
    const scoped = this.sameScope();
    const targeted = state.project !== null && !!this.worktree && state.node === this.node && state.worktree === this.worktree && !this.repo?.closed;
    const kind = !scoped ? 'unknown' : state.surface === 'composer' ? state.git_status
      : this.repo?.status ? (this.repo.status.kind === 'directory' ? 'plain_directory' : 'repository') : 'unknown';
    const repository = kind === 'repository';
    const menu = targeted && repository ? branchMenu(state,this.entries(),this.checkouts,this.text,this.worktrees)
      : {choices:[],value:null};
    publishContributions([
      {id:'branch',...(targeted && repository ? {label:{label:label(state,this.text)}} : {}),icon:'network',loading:false,
        enabled:scoped && repository && state.can_move && menu.choices.length > 0,visible:targeted && repository,
        value:menu.value,choices:menu.choices,...(event?.id === 'branch' ? {reply_to:event.sequence} : {})},
      {id:'manage',enabled:scoped && repository && state.can_move,visible:targeted && repository,...(event?.id === 'manage' ? {reply_to:event.sequence} : {})}
    ]);
  }
  render() { return div().child(dialogs(this)); }
}
