// Curated policy adapted from Sailry's original Memory package.
// ZCode 872ad960 informed its curated categories; recall now ranks by relevance first.
export function bytes(text) {
  let size = 0;
  for (const character of text) {
    const code = character.codePointAt(0);
    size += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return size;
}
export const content = text => ({role:"user",parts:[{text}]});
const cost = text => bytes(JSON.stringify(content(text))) + 128;

const guidance = "Memory holds lasting user preferences, corrections and decisions. Use the relevant memories below when they apply; current instructions win.";
const writing = "Save with save_memory when the user states a lasting preference, corrects you, confirms a decision, or asks you to remember something. Do not save secrets, task progress or facts available in code, Git or project docs.";
export const policy = settings => `${guidance} ${settings.auto_write ? writing : "Memory is read-only this turn."}`;
export const relevantLimit = 5;
const activity = summary => Math.max(summary.updated_at_ms,summary.last_recalled ?? 0);
export const ranked = (left,right) => activity(right)-activity(left) || (right.recalled ?? 0)-(left.recalled ?? 0)
  || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

// Relevant complete bodies come first; remaining active titles share the same half budget.
export function instruction({relevant=[],entries=[],settings,pending=false}) {
  let text = `\n\n${policy(settings)}`;
  if (pending) return {text:`${text} Memory is changing; use search_memory for current entries.`,injected:[]};
  const limit = Math.floor(settings.context_bytes / 2);
  let size = bytes(text);
  const injected = [];
  const append = (heading,line) => {
    const addition = heading+line, added = bytes(addition);
    if (size+added > limit) return false;
    text += addition; size += added;
    return true;
  };
  for (const entry of relevant) {
    if (injected.length === relevantLimit) break;
    const {id,title,kind,project,revision} = entry.summary;
    const line = `\n${JSON.stringify({id,title,kind,global:project === null,revision,body:entry.body})}`;
    if (append(injected.length ? '' : '\n\nRelevant memories:',line)) injected.push(entry);
  }
  const shown = new Set(injected.map(entry=>entry.summary.id));
  let heading = `\n\n${injected.length ? 'Other memories' : 'Memories'} (title and ID):`;
  for (const summary of entries.filter(summary=>!summary.archived && !shown.has(summary.id)).sort(ranked)) {
    if (append(heading,`\n- ${summary.title} (${summary.id})`)) heading = '';
  }
  return {text,injected};
}

export function values(entries, state) {
  return entries.filter(entry => {
    const size = cost(JSON.stringify(entry));
    if (size > state.remaining) return false;
    state.remaining -= size;
    return true;
  });
}

export function retrieve(entries, state) {
  const results = [];
  for (const entry of entries) {
    const characters = Array.from(entry.body);
    const encode = end => JSON.stringify({body:characters.slice(0,end).join(""),body_truncated:end < characters.length,summary:entry.summary});
    let text = encode(characters.length);
    if (cost(text) > state.remaining) {
      let low = 0, high = characters.length + 1;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (cost(encode(middle)) <= state.remaining) low = middle + 1;
        else high = middle;
      }
      if (low <= 1) continue;
      text = encode(low - 1);
    }
    const size = cost(text);
    if (size <= state.remaining) {
      state.remaining -= size;
      results.push(content(text));
    }
  }
  return results;
}

export function reads(results) {
  const visible = [];
  for (const result of results) {
    const response=result.response?.context ?? result.response;
    const entries=result.name==='search_memory' ? response?.entries
      : result.name==='save_memory' && response?.status==='similar' && response.saved===false ? response.existing
      : ['save_memory','consolidate_memories'].includes(result.name) && response?.status==='changed' && response.saved===false ? response.latest : null;
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      for (const part of entry?.parts ?? []) {
        if (typeof part.text !== "string") continue;
        try {
          const value = JSON.parse(part.text);
          if (value.body_truncated === false && typeof value.body === "string" && value.body.length > 0 && typeof value.summary?.id === "string" && Number.isSafeInteger(value.summary.revision)) {
            visible.push([value.summary.id,value.summary.revision]);
          }
        } catch { /* Non-memory text carries no replacement authority. */ }
      }
    }
  }
  return visible;
}

export function requireRead(state, id, revision) {
  if (!(state.reads ?? []).some(([entry,current]) => entry === id && current === revision)) {
    fail("call search_memory with this ID to read its complete current body, then retry with its revision; titles and truncated bodies are not enough");
  }
}
export function fail(message, code = "invalid_request") {
  const error = new Error(message);
  error.code = code;
  throw error;
}
export function argumentsFor(value, allowed, required) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !(key in value))) fail("invalid memory arguments");
  for (const key of ["title","body","query"]) if (key in value && typeof value[key] !== "string") fail("invalid memory arguments");
  for (const key of ["global","archived"]) if (key in value && typeof value[key] !== "boolean") fail("invalid memory arguments");
  if ("kind" in value && !["user","feedback","project","reference"].includes(value.kind)) fail("invalid memory arguments");
  if ("expected_revision" in value && (!Number.isSafeInteger(value.expected_revision) || value.expected_revision < 0)) fail("invalid memory arguments");
  if (value.id != null && (typeof value.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.id))) fail("invalid memory arguments");
  return value;
}
