import {View, div} from "gpui-kit";
import {Action, state, theme, nextChange, status, toast} from "sailry/card";
import {messages} from "./locales.js";

export default class Connection extends View {
  init(_props, cx) {
    this.state = state(); this.loading = false; this.action = null;
    this.text = messages(this.state.locale);
    cx.spawn(async cx => {
      let cursor = this.state.cursor;
      try {
        while (true) {
          const update = await nextChange(cursor); cursor = update.cursor;
          this.state = update;
          if (update.action && update.action !== this.action) {
            this.action = update.action; this.refresh(cx);
          }
          cx.notify();
        }
      } catch (_) { /* Native release ends this instance's observation. */ }
    });
    this.refresh(cx);
  }
  refresh(cx) {
    if (this.loading) return;
    this.loading = true; cx.notify();
    cx.spawn(async cx => {
      try { await status(); }
      catch (_) { toast(this.text.failed, true); }
      finally { this.loading = false; cx.notify(); }
    });
  }
  render(_cx) {
    const colors = theme().colors, text = this.text, state = this.state;
    const busy = this.loading || ["starting", "exchanging"].includes(state.login);
    const pending = state.login === "pending";
    const unknown = state.login === "unconfirmed" || (state.login === "failed" && state.can_cancel);
    const statusLabel = state.configured ? text.connected
      : ["starting", "pending", "exchanging"].includes(state.login) ? text[state.login] : text.connect;
    return div().id("notion-connection-card").v_flex().w_full().min_w_0().gap_2().p_3()
      .rounded_md().border_1().border_color(colors.border).bg(colors.background).text_color(colors.foreground)
      .child(div().font_semibold().child(text.title))
      .child(div().text_sm().text_color(colors.muted_foreground).child(statusLabel))
      .child(div().h_flex().gap_2().flex_wrap()
        .children(!state.configured && !pending ? [
          Action.new("notion-login", {label:unknown ? text.check : text.login, primary:true, disabled:busy,
            action:unknown ? {kind:"connect"} : {kind:"connect",target:"login",mode:"embedded"}}),
          ...(!unknown ? [Action.new("notion-login-external", {label:text.external,disabled:busy,
            action:{kind:"connect",target:"login",mode:"external"}})] : []),
        ] : [])
        .children(pending ? [
          Action.new("notion-open-login", {label:text.open,disabled:busy || !state.can_open,action:{kind:"browser",target:"login",mode:"embedded"}}),
          Action.new("notion-open-external", {label:text.openExternal,disabled:busy || !state.can_open,action:{kind:"browser",target:"login",mode:"external"}}),
        ] : [])
        .children(state.can_cancel ? [Action.new("notion-cancel-login", {label:text.cancel,disabled:busy,action:{kind:"cancel"}})] : [])
        .child(Action.new("notion-refresh", {label:text.refresh,disabled:busy,action:{kind:"refresh"}})));
  }
}
