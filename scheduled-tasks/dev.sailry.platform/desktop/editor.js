import {div} from "gpui-kit";
import {Button, Field, VForm} from "gpui-component";
import {ModelPopup, SegmentedTabs, SelectField, Toggle} from "sailry/ui";
import {TextField, createText, readText, releaseText,
  DateTimeField, createDateTime, readDateTime, releaseDateTime} from "sailry/forms";

export function editor(item, text) {
  const draft = item ? {...item} : {revision:"0",name:"",prompt:"",queue:"default",project:null,worktree:null,
    config:null,enabled:true,timing:{kind:"once",data:{at_ms:Date.now() + 300000}}};
  const data = draft.timing.data;
  const editing = {draft,kind:draft.timing.kind,model:draft.config ? `${draft.config.provider}/${draft.config.model}` : null,
    modelLoading:false,modelVersion:0,
    name:createText(draft.name,{label:text.name,placeholder:text.namePlaceholder}),
    prompt:createText(draft.prompt,{label:text.prompt,placeholder:text.promptPlaceholder,multiline:true}),
    start:data.at_ms ?? data.anchor_ms ?? Date.now() + 300000,
    seconds:String((data.interval_ms ?? 3600000) / 1000),
    clock:`${String(data.hour ?? 9).padStart(2,"0")}:${String(data.minute ?? 0).padStart(2,"0")}`,
    zone:data.timezone ?? "",weekdays:[...(data.weekdays ?? [1,2,3,4,5])],
    interval:null,time:null,wallTime:null,timezone:null};
  openTiming(editing, text);
  return editing;
}
function openTiming(editing, text) {
  if (editing.kind === "weekly") {
    editing.wallTime = createText(editing.clock,{label:text.localTime,placeholder:text.timePlaceholder});
    editing.timezone = createText(editing.zone,{label:text.timezone,placeholder:text.timezonePlaceholder});
  } else {
    editing.interval = createText(editing.seconds,{label:text.interval,placeholder:text.intervalPlaceholder});
    editing.time = createDateTime(editing.start,text.time);
  }
}
export function setTiming(editing, kind, text) {
  if (kind === editing.kind || !["once","every","weekly"].includes(kind)) return;
  if ((kind === "weekly") !== (editing.kind === "weekly")) {
    if (editing.kind === "weekly") {
      editing.clock = readText(editing.wallTime); editing.zone = readText(editing.timezone);
      releaseText(editing.wallTime); releaseText(editing.timezone);
      editing.wallTime = null; editing.timezone = null;
    } else {
      try { editing.start = readDateTime(editing.time); } catch (_) { /* Keep the last valid start. */ }
      editing.seconds = readText(editing.interval);
      releaseDateTime(editing.time); releaseText(editing.interval);
      editing.time = null; editing.interval = null;
    }
    editing.kind = kind;
    openTiming(editing,text);
  } else editing.kind = kind;
}
export function release(editor) {
  for (const field of [editor.name,editor.prompt,editor.interval,editor.wallTime,editor.timezone]) {
    if (field !== null) releaseText(field);
  }
  if (editor.time !== null) releaseDateTime(editor.time);
}
export function value(editor) {
  const name = readText(editor.name).trim(), prompt = readText(editor.prompt);
  if (!name || !prompt.trim()) throw new Error("required");
  if (!editor.draft.config || !editor.model) throw new Error("modelRequired");
  if (editor.kind === "weekly") {
    const parts = /^(\d{1,2}):(\d{2})$/.exec(readText(editor.wallTime).trim());
    if (!parts || Number(parts[1]) > 23 || Number(parts[2]) > 59) throw new Error("invalidClock");
    const timezone = readText(editor.timezone).trim();
    if (!timezone) throw new Error("timezoneRequired");
    if (!editor.weekdays.length) throw new Error("weekdaysRequired");
    return {...editor.draft,name,prompt,timing:{kind:"weekly",data:{timezone,
      weekdays:[...editor.weekdays].sort((left,right) => left-right),hour:Number(parts[1]),minute:Number(parts[2])}}};
  }
  let at;
  try { at = readDateTime(editor.time); } catch (_) { throw new Error("invalidTime"); }
  if (editor.draft.revision === "0" && at <= Date.now()) throw new Error("invalidTime");
  let timing = {kind:"once",data:{at_ms:at}};
  if (editor.kind === "every") {
    const seconds = Number(readText(editor.interval));
    if (!Number.isFinite(seconds) || seconds < 1 || seconds > 31536000) throw new Error("invalidInterval");
    timing = {kind:"every",data:{anchor_ms:at,interval_ms:Math.round(seconds * 1000)}};
  }
  return {...editor.draft,name,prompt,timing};
}
function projects(view, disabled) {
  const {text,editing} = view;
  const items = [{id:"none",label:text.noProject},...view.catalog.projects.map(({id,name}) => ({id,label:name}))];
  if (editing.draft.project && !items.some(item => item.id === editing.draft.project)) {
    items.push({id:editing.draft.project,label:text.unavailable});
  }
  return SelectField.new("task-project",{label:text.project,placeholder:text.projectPlaceholder,
    selected:editing.draft.project ?? "none",items,disabled});
}
function worktrees(view, disabled) {
  const {text,editing} = view;
  const trees = view.catalog.worktrees.filter(tree => tree.project === editing.draft.project);
  const items = [{id:"main",label:text.mainWorktree},...trees.map(({id,path}) => ({id,label:path}))];
  if (editing.draft.worktree && !items.some(item => item.id === editing.draft.worktree)) {
    items.push({id:editing.draft.worktree,label:text.unavailable});
  }
  return SelectField.new("task-worktree",{label:text.worktree,placeholder:text.worktreePlaceholder,
    selected:editing.draft.worktree ?? "main",items,disabled});
}
export function effortKey(value) { return typeof value === "string" ? value : String(value.budget); }
function strength(view, disabled) {
  const {text,editing} = view;
  const model = view.models.find(model => model.id === editing.model);
  const choices = (model?.efforts ?? []).filter(effort => effort !== "default");
  return SelectField.new("task-strength",{label:text.strength,
    placeholder:model && !choices.length ? text.noStrength : text.strengthPlaceholder,
    selected:editing.draft.config ? effortKey(editing.draft.config.effort) : null,
    items:choices.map(effort => ({id:effortKey(effort),label:effortKey(effort)})),
    disabled:disabled || !choices.length || editing.modelLoading});
}
export function render(view) {
  const {text,editing} = view, disabled = view.busy || !!view.pending;
  return [div().id("task-editor").w_full()
    .child(new VForm().w_full().gap_3()
      .child(new Field().label(text.name).child(TextField.new(editing.name,{disabled})))
      .child(new Field().label(text.prompt).child(TextField.new(editing.prompt,{disabled})))
      .child(new Field().label(text.schedule).child(SegmentedTabs.new("task-timing",{selected:editing.kind,
        items:[{id:"once",label:text.once},{id:"every",label:text.every},{id:"weekly",label:text.weekly}],disabled,fill:true})))
      .children(editing.kind === "weekly" ? [
        new Field().label(text.weekdays).child(div().h_flex().flex_wrap().gap_2()
          .children([1,2,3,4,5,6,7].map(day => Toggle.new(`task-weekday-${day}`,{
            label:text[`weekday${day}`],variant:"button",checked:editing.weekdays.includes(day),disabled})))),
        new Field().label(text.localTime).child(TextField.new(editing.wallTime,{disabled})),
        new Field().label(text.timezone).child(TextField.new(editing.timezone,{disabled})),
      ] : [new Field().label(text.time).child(DateTimeField.new(editing.time,{disabled}))])
      .children(editing.kind === "every" ? [new Field().label(text.interval).child(TextField.new(editing.interval,{disabled}))] : [])
      .child(new Field().label(text.project).child(projects(view,disabled)))
      .children(editing.draft.project ? [new Field().label(text.worktree).child(worktrees(view,disabled))] : [])
      .child(new Field().label(text.model).child(ModelPopup.new("task-model",{label:text.model,
        placeholder:editing.draft.config?.model ?? text.modelPlaceholder,catalog:{models:view.models},
        selected:editing.model,effort:editing.draft.config?.effort ?? "default",disabled:disabled || view.loading || editing.modelLoading}))
        .children(view.modelsError ? [new Button("task-models-retry").label(text.retry).disabled(view.loading)
          .on_click((_,cx) => view.refresh(cx))] : []))
      .child(new Field().label(text.strength).child(strength(view,disabled)))),
    div().h_flex().flex_shrink(0).justify_end().gap_2()
      .child(new Button("task-cancel").label(text.cancel).disabled(view.busy).on_click((_,cx) => view.close(cx)))
      .child(new Button("task-save").primary().label(view.pending ? text.retry : text.save)
        .disabled(view.busy || editing.modelLoading).on_click((_,cx) => view.save(cx)))];
}
