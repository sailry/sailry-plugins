import {readLocation,nextLocationChange,openResource} from 'sailry/ui';
import {context as readScope,publishContributions,nextContributionEvent} from 'sailry/sdk';
import Git from './main.js';
import {dialogs} from './view.js';

const clearsBadge = new Set(['revision_conflict','not_found','permission_denied','wrong_target']);

export default class Context extends Git {
  init(props,cx) {
    this.overlay = true;
    this.worktree = readScope().worktree;
    this.location = readLocation();
    this.node = this.location?.node;
    super.init(props,cx);
    this.publish();
    cx.spawn(async cx => {
      try { while (true) {
        const previous = this.location;
        this.location = await nextLocationChange(previous.cursor);
        if (!this.sameScope()) { this.actions.picker = null; this.clearCounts(); }
        else {
          this.publish();
          if (this.location.git_status !== previous.git_status) await this.invalidate();
        }
        cx.notify();
      } } catch (_) { /* The controller retains its original checkout. */ }
    });
    cx.spawn(async cx => {
      try { while (true) {
        const event = await nextContributionEvent(); this.publish(event);
        if (!this.sameScope()) { cx.notify(); continue; }
        this.run(async () => {
          if (event.id === 'changes') { await openResource('git',{path:null}); return; }
          await this.openPicker(event.id);
        },cx);
      } } catch (_) { /* Disabling the package releases contribution events. */ }
    });
  }
  async openPicker(kind) {
    if (this.actions.picker?.loading && this.actions.picker.contribution === kind) return;
    const picker = this.actions.choose('git_manage_branches',[]);
    picker.contribution = kind; picker.loading = true; this.notify();
    let ready = false;
    try { ready = await this.repo.refresh(); }
    finally {
      if (this.actions.picker === picker) {
        if (ready && this.sameScope()) this.actions.update(picker,kind === 'branch' ? this.menus.checkout() : this.menus.management());
        else { this.actions.picker = null; this.notify(); }
      }
    }
  }
  sameScope() {
    return !!this.worktree && this.location?.node === this.node
      && this.location?.worktree === this.worktree && this.location.connected !== false
      && this.repo?.connected !== false && !this.repo?.closed;
  }
  clearCounts() {
    this.badgeRead = (this.badgeRead ?? 0) + 1;
    this.counts = null;
    this.publish();
  }
  refreshWorktrees(cx) {
    super.refreshWorktrees(cx);
    if (!this.repo.connected) this.clearCounts();
  }
  async invalidate() {
    const sequence = this.badgeRead = (this.badgeRead ?? 0) + 1;
    if (!this.sameScope() || this.location.surface === 'composer' && this.location.git_status !== 'repository') {
      this.counts = null; this.publish(); return;
    }
    if (!await this.repo.invalidate()) {
      if (this.badgeRead === sequence && this.sameScope() && clearsBadge.has(this.repo.readCode)) {
        this.counts = null; this.publish(); this.notify?.();
      }
      return;
    }
    if (this.badgeRead !== sequence || !this.sameScope()) return;
    if (this.location.surface !== 'composer' || this.repo.status.kind === 'directory') { this.counts = null; this.publish(); return; }
    let added = 0, removed = 0, partial = this.repo.status.truncated || this.repo.status.omitted_paths > 0;
    for (const entry of this.repo.status.entries) {
      added += entry.diff.additions; removed += entry.diff.deletions;
      partial ||= entry.diff.truncated === true;
    }
    this.counts = {added,removed,partial};
    this.publish(); this.notify();
  }
  publish(event) {
    const state = this.location;
    if (!state) return;
    const scoped = this.sameScope();
    const targeted = state.project !== null && !!this.worktree && state.node === this.node && state.worktree === this.worktree && !this.repo?.closed;
    const kind = !scoped ? 'unknown' : state.surface === 'composer' ? state.git_status
      : this.repo?.status ? (this.repo.status.kind === 'directory' ? 'plain_directory' : 'repository') : 'unknown';
    const repository = kind === 'repository';
    publishContributions([
      {id:'branch',...(targeted && repository ? {label:{label:state.branch || this.text.git_detached}} : {}),icon:'network',loading:false,enabled:scoped && repository && state.can_move,visible:targeted && state.main && repository,dropdown:true,...(event?.id === 'branch' ? {reply_to:event.sequence} : {})},
      {id:'manage',enabled:scoped && repository && state.can_move,visible:targeted && repository,...(event?.id === 'manage' ? {reply_to:event.sequence} : {})},
      {id:'changes',enabled:true,visible:scoped && repository && state.surface === 'composer' && !!this.counts,value:this.counts?.partial ? this.text.tool_partial : null,
        segments:this.counts ? [{label:{label:`+${this.counts.added}`},tone:'success'},{label:{label:`-${this.counts.removed}`},tone:'danger'}] : [],
        ...(event?.id === 'changes' ? {reply_to:event.sequence} : {})}
    ]);
  }
  render() { return dialogs(this); }
}
