const MAX_SYMBOLS = 20;
const MAX_SNIPPETS = 5;
const MAX_BYTES = 16 * 1024;
const MAX_LINES = 80;

function invalid(message) {
  return {result:{isError:true,error:{code:'invalid_request',message}}};
}

function bytes(text) {
  let count = 0;
  for (const character of text) {
    const point = character.codePointAt(0);
    count += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return count;
}

function size(value) { return bytes(JSON.stringify(value)); }

function bound(value, fallback, maximum, minimum=1) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error('Invalid code context limit');
  }
  return value;
}

function options(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid code context query');
  const query = {limit:bound(input.limit,MAX_SYMBOLS,MAX_SYMBOLS)};
  for (const key of ['query','name','path','language']) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'string') throw new Error('Invalid code context filter');
      query[key] = input[key];
    }
  }
  return {query, snippets:bound(input.max_snippets,MAX_SNIPPETS,MAX_SNIPPETS),
    budget:bound(input.max_bytes,MAX_BYTES,MAX_BYTES,512)};
}

function valid(symbol) {
  const range = symbol?.range;
  return typeof symbol?.path === 'string' && typeof symbol.file_revision === 'string'
    && symbol.file_revision.length > 0 && range
    && ['start_byte','end_byte','start_line','start_column','end_line','end_column']
      .every(key => Number.isSafeInteger(range[key]) && range[key] >= 0)
    && range.end_byte >= range.start_byte && range.end_line >= range.start_line;
}

function omitted(data) {
  data.partial = true;
  data.truncated = true;
}

function metadata(page, limit, budget) {
  if (!page || !Array.isArray(page.symbols) || !page.symbols.every(valid)
      || !Number.isSafeInteger(page.index_revision) || page.index_revision < 0
      || !Array.isArray(page.issues)) throw new Error('Invalid code search result');
  const data = {symbols:page.symbols.slice(0,limit),snippets:[],index_revision:page.index_revision,
    partial:page.partial === true,truncated:page.truncated === true,
    visited:page.visited,skipped:page.skipped,issues:page.issues.slice(0,10)};
  if (page.symbols.length > data.symbols.length || page.issues.length > data.issues.length) omitted(data);
  while (size(data) > budget && data.issues.length) {
    data.issues.pop();
    omitted(data);
  }
  while (size(data) > budget && data.symbols.length) {
    data.symbols.pop();
    omitted(data);
  }
  if (size(data) > budget) throw new Error('Code context metadata exceeds the output budget');
  return data;
}

function ranges(data, limit) {
  const files = new Map();
  for (const symbol of data.symbols) {
    const key = JSON.stringify([symbol.path,symbol.file_revision]);
    const range = symbol.range;
    const start = Math.max(0,range.start_line-2);
    const end = Math.max(range.start_line+1,range.end_line+(range.end_column > 0 ? 1 : 0))+2;
    if (!files.has(key)) files.set(key,[]);
    files.get(key).push({path:symbol.path,file_revision:symbol.file_revision,start,end});
  }
  const merged = [];
  for (const file of files.values()) {
    file.sort((left,right) => left.start-right.start || left.end-right.end);
    let previous;
    for (const range of file) {
      if (previous && range.start <= previous.end) previous.end = Math.max(previous.end,range.end);
      else {
        previous = {...range};
        merged.push(previous);
      }
    }
  }
  if (merged.length > limit) omitted(data);
  return merged.slice(0,limit).map(range => {
    const length = range.end-range.start;
    if (length > MAX_LINES) omitted(data);
    return {...range,limit:Math.min(length,MAX_LINES),truncated:length > MAX_LINES};
  });
}

function read(state) {
  const range = state.ranges[state.next];
  return {call:{operation:'files.read_lines',arguments:{path:range.path,offset:range.start,
    limit:range.limit,expected_revision:range.file_revision}},state};
}

function append(state, lines) {
  const range = state.ranges[state.next];
  if (!lines || lines.path !== range.path || lines.revision !== range.file_revision
      || lines.offset !== range.start || !Array.isArray(lines.lines)
      || lines.lines.length > range.limit
      || !lines.lines.every((line,index) => line.number === range.start+index+1 && typeof line.text === 'string')) {
    throw new Error('Invalid revision-checked source result');
  }
  const incomplete = lines.next_offset != null && lines.next_offset < range.start+range.limit;
  if (incomplete) omitted(state.data);
  if (!lines.lines.length) {
    state.data.partial = true;
    return;
  }
  const snippet = {path:range.path,file_revision:range.file_revision,
    start_line:lines.lines[0].number,end_line:lines.lines[lines.lines.length-1].number,
    text:lines.lines.map(line => line.text).join(''),truncated:range.truncated || incomplete};
  state.data.snippets.push(snippet);
  if (size(state.data) <= state.budget) return;
  omitted(state.data);
  snippet.truncated = true;
  const characters = Array.from(snippet.text);
  let low = 0, high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low+high)/2);
    snippet.text = characters.slice(0,middle).join('');
    if (size(state.data) <= state.budget) low = middle;
    else high = middle-1;
  }
  snippet.text = characters.slice(0,low).join('');
  if (!snippet.text || size(state.data) > state.budget) state.data.snippets.pop();
  else snippet.end_line = snippet.start_line+snippet.text.split('\n').length-1-(snippet.text.endsWith('\n') ? 1 : 0);
}

/** One symbol search followed by at most five version-checked source reads. */
export function context({arguments:input={},step,state,outcome}) {
  try {
    if (!Number.isInteger(step) || step < 0 || step > MAX_SNIPPETS+1) return invalid('Invalid code context continuation');
    if (step === 0) {
      const limits = options(input);
      return {call:{operation:'code.search',arguments:limits.query},state:{...limits,next:0}};
    }
    if (outcome?.isError) return {result:outcome};
    if (step === 1) {
      const data = metadata(outcome?.data,state.query.limit,state.budget);
      state = {...state,data,ranges:ranges(data,state.snippets)};
    } else {
      if (!state?.ranges || state.next !== step-2) return invalid('Invalid code context continuation');
      append(state,outcome?.data);
      state.next++;
    }
    if (state.next >= state.ranges.length || size(state.data)+128 >= state.budget) {
      if (state.next < state.ranges.length) omitted(state.data);
      return {result:state.data};
    }
    return read(state);
  } catch (error) {
    return invalid(error.message);
  }
}
