import {readLocation,nextLocationChange,openResource} from 'sailry/ui';
import {context as readScope,publishContributions,nextContributionEvent,readGitDiff,faultCode} from 'sailry/sdk';
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
        if (!this.sameScope()) this.clearCounts();
        else {
          this.publish();
          if (this.location.git !== previous.git) await this.invalidate();
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
          if (await this.repo.refresh() && this.sameScope()) this.actions.choose('git_manage_branches',event.id === 'branch' ? this.menus.checkout() : this.menus.management());
        },cx);
      } } catch (_) { /* Disabling the package releases contribution events. */ }
    });
  }
  sameScope() {
    return !!this.worktree && this.location?.node === this.node
      && this.location?.worktree === this.worktree && this.location.connected !== false
      && this.repo?.connected !== false;
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
    if (!this.sameScope() || this.location.surface === 'composer' && !this.location.git) {
      this.counts = null; this.publish(); return;
    }
    if (!await this.repo.refresh()) {
      if (this.badgeRead === sequence && this.sameScope() && clearsBadge.has(this.repo.readCode)) {
        this.counts = null; this.publish(); this.notify?.();
      }
      return;
    }
    if (this.badgeRead !== sequence || !this.sameScope()) return;
    if (this.location.surface !== 'composer' || this.repo.status.kind === 'directory') { this.counts = null; this.publish(); return; }
    let added = 0, removed = 0, partial = this.repo.status.truncated || this.repo.status.omitted_paths > 0;
    try {
      for (const entry of this.repo.status.entries) {
        if (this.badgeRead !== sequence || !this.sameScope()) return;
        const diff = await readGitDiff(entry.path,'all');
        if (this.badgeRead !== sequence || !this.sameScope()) return;
        added += diff.additions; removed += diff.deletions; partial ||= diff.truncated;
      }
      if (this.badgeRead === sequence) { this.counts = {added,removed,partial}; this.publish(); this.notify(); }
    } catch (error) {
      if (this.badgeRead !== sequence || !this.sameScope()) return;
      if (clearsBadge.has(faultCode(error.message ?? String(error)))) this.counts = null;
      this.report('git_read_failed'); this.publish(); this.notify?.();
    }
  }
  publish(event) {
    const state = this.location;
    if (!state) return;
    const scoped = this.sameScope();
    publishContributions([
      {id:'branch',...(scoped && state.git ? {label:{label:state.branch || this.text.git_detached}} : {}),icon:'network',enabled:state.can_move,visible:scoped && state.main && state.git,dropdown:true,...(event?.id === 'branch' ? {reply_to:event.sequence} : {})},
      {id:'manage',enabled:state.can_move,visible:scoped && state.git,...(event?.id === 'manage' ? {reply_to:event.sequence} : {})},
      {id:'changes',enabled:true,visible:scoped && state.git && state.surface === 'composer' && !!this.counts,value:this.counts?.partial ? this.text.tool_partial : null,
        segments:this.counts ? [{label:{label:`+${this.counts.added}`},tone:'success'},{label:{label:`-${this.counts.removed}`},tone:'danger'}] : [],
        ...(event?.id === 'changes' ? {reply_to:event.sequence} : {})}
    ]);
  }
  render() { return dialogs(this); }
}
