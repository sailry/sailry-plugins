import {readLocation,nextLocationChange,openResource} from 'sailry/ui';
import {context as readScope,publishContributions,nextContributionEvent} from 'sailry/sdk';
import Git from './main.js';
import {dialogs} from './view.js';
import {render} from './branch-menu.js';

export default class Context extends Git {
  init(props,cx) {
    this.overlay = true;
    this.worktree = readScope().worktree;
    this.location = readLocation();
    this.node = this.location?.node;
    this.menuOpen = false; this.branchPath = [];
    super.init(props,cx);
    this.publish();
    cx.spawn(async cx => {
      try { while (true) {
        const previous = this.location;
        this.location = await nextLocationChange(previous.cursor);
        if (!this.sameScope()) { this.actions.picker = null; this.menuOpen = false; this.branchPath = []; this.publish(); }
        else {
          this.publish();
          if (this.location.surface !== 'composer' && this.location.git_status !== previous.git_status) await this.invalidate();
        }
        cx.notify();
      } } catch (_) { /* The controller retains its original checkout. */ }
    });
    cx.spawn(async cx => {
      try { while (true) {
        const event = await nextContributionEvent();
        if (event.id === 'branch') this.menuOpen = event.kind === 'invoke' || event.value === true;
        this.publish(event);
        if (!this.sameScope()) { cx.notify(); continue; }
        const open = this.menuOpen;
        this.run(async () => {
          if (event.id === 'changes') { await openResource('git',{path:null}); return; }
          if (event.id === 'branch') { await this.openBranches(open); return; }
          await this.openPicker(event.id);
        },cx);
      } } catch (_) { /* Disabling the package releases contribution events. */ }
    });
  }
  async openBranches(open) {
    this.menuOpen = open; this.branchPath = []; this.publish(); this.notify();
    if (!open || !this.sameScope()) return;
    await this.repo.refresh();
    this.publish(); this.notify();
  }
  branchChoices() {
    if (this.branchPath.length) return this.branchPath.at(-1).items;
    if (this.repo?.branches) return this.menus.checkout();
    const name = this.location?.branch || this.text.git_detached;
    return [{id:'current',label:name,icon:'network',checked:true,disabled:true,value:{kind:'noop'}}];
  }
  async selectBranch(choice) {
    if (!this.sameScope() || !this.location.can_move || !this.repo.writable() || choice.disabled) return;
    if (choice.value.kind === 'choose') this.branchPath.push(choice.value);
    else {
      this.menuOpen = false; this.publish();
      await this.actions.invoke(choice.value);
    }
    this.publish(); this.notify();
  }
  back() { this.branchPath.pop(); this.notify(); }
  async openPicker(kind) {
    if (this.actions.picker?.loading && this.actions.picker.contribution === kind) return;
    this.menuOpen = false; this.publish();
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
    publishContributions([
      {id:'branch',...(targeted && repository ? {label:{label:state.branch || this.text.git_detached}} : {}),icon:'network',loading:false,enabled:scoped && repository && state.can_move,visible:targeted && repository,dropdown:true,value:this.menuOpen,...(event?.id === 'branch' ? {reply_to:event.sequence} : {})},
      {id:'manage',enabled:scoped && repository && state.can_move,visible:targeted && repository,...(event?.id === 'manage' ? {reply_to:event.sequence} : {})}
    ]);
  }
  render() { return render(this,dialogs(this)); }
}
