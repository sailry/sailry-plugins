import {fail,fields,identifier,integer,limits,path,size,text} from './policy.js';
import {head,identity,key,manifest,record} from './records.js';
import {delivered,deliveryBytes} from './delivery.js';

export function available(file) {
  if (!file.content || !['diff','old','new'].every(part => {
    const range=file.content[part];
    return range && Number.isSafeInteger(range.start) && range.start >= 0
      && Number.isSafeInteger(range.count) && range.count > 0;
  })) fail('Review content is unavailable; create a new review scope','not_found');
}

export async function* pages(value,file,part,captured=null) {
  available(file);
  const range=file.content[part];
  let offset=0;
  for (let index=0;index<range.count;index++) {
    const name=key(value.id,`data/${range.start+index}`),current=captured===null?await record(name):captured.get(name);
    const page=current.value;
    if (!current.present || current.revision !== '1' || page?.v !== 1 || page.kind !== 'content'
        || page.capture !== value.id || page.path !== file.path || page.part !== part
        || page.revision !== file.revision || page.offset !== offset) fail('Review content is incomplete','internal');
    const rows=part === 'diff' ? page.lines : typeof page.text === 'string'
      ? page.text.match(/[^\n]*\n|[^\n]+$/g) ?? [] : null;
    if (!Array.isArray(rows) || (part === 'diff' && rows.some(line =>
      !line || !['added','deleted','context'].includes(line.kind) || typeof line.text !== 'string'
      || line.text.includes('\n') || (line.kind !== 'deleted' && (!Number.isSafeInteger(line.new_line) || line.new_line < 1))
      || (line.kind !== 'added' && (!Number.isSafeInteger(line.old_line) || line.old_line < 1))))) {
      fail('Review content is invalid','internal');
    }
    const next=offset+rows.length;
    if (index+1 === range.count ? page.next !== null : page.next !== next || next <= offset) {
      fail('Review content cursor is incomplete','internal');
    }
    yield {...page,rows};
    offset=next;
  }
}

export async function verify(value,file) {
  available(file);
  const parts=['diff','old','new'],names=parts.flatMap(part=>Array.from({length:file.content[part].count},(_,index)=>key(value.id,`data/${file.content[part].start+index}`)));
  const captured=new Map(await Promise.all(names.map(async name=>[name,await record(name)])));
  for (const part of parts) for await (const _page of pages(value,file,part,captured)) { /* Validate every captured page. */ }
}

async function readPage(value,file,part,offset,limit,budget) {
  const result={review_id:value.id,snapshot:value.snapshot,path:file.path,
    old_path:file.old_path,metadata_revision:file.metadata_revision,revision:file.revision,
    part,offset,next:null,...(part === 'diff' ? {lines:[]} : {text:''})};
  let used=size(result);
  if (used > budget) return null;
  let position=0, count=0;
  for await (const page of pages(value,file,part)) {
    for (const row of page.rows) {
      if (position++ < offset) continue;
      if (count === limit) { result.next=offset+count; return result; }
      // Array rows add a separator. Text rows lose their surrounding JSON quotes.
      const addition=size(row)+(part === 'diff' ? Number(count > 0) : -2);
      const more=page.next !== null || position < page.offset+page.rows.length;
      const cursor=more ? Math.max(0,String(offset+count+1).length-4) : 0;
      if (used+addition+cursor > budget) {
        if (!count) return null;
        result.next=offset+count;
        return result;
      }
      if (part === 'diff') result.lines.push(row); else result.text+=row;
      used+=addition;
      count++;
    }
  }
  if (offset > position) fail('Review content offset exceeds the source');
  return result;
}

export async function diffs(value,files,offset=0,limit=Number.MAX_SAFE_INTEGER,budget=limits.output) {
  if (offset > files.length) fail('Review file offset exceeds the selection');
  const result={review_id:value.id,snapshot:value.snapshot,offset,next:null,files:[]};
  const cursor=Math.max(0,String(files.length).length-4);
  let used=size(result)+cursor;
  if (used > budget) return null;
  let index=offset;
  for (;index < files.length;index++) {
    const separator=Number(index > offset);
    const page=await readPage(value,files[index],'diff',0,limit,budget-used-separator);
    if (!page) break;
    result.files.push(page);
    used+=size(page)+separator;
  }
  result.next=index < files.length ? index : null;
  return result;
}

export async function read(input) {
  const args=fields(input,['review_id','path','paths','group','part','offset','limit'],['review_id']);
  identifier(args.review_id);
  if (['path','paths','group'].filter(key=>Object.hasOwn(args,key)).length !== 1) {
    fail('Select a review path, paths, or group');
  }
  const part=args.part ?? 'diff';
  if (!['diff','old','new'].includes(part)) fail('Invalid review content part');
  const offset=integer(args.offset ?? 0,'review content offset',0,Number.MAX_SAFE_INTEGER);
  const defaultLimit=args.path === undefined ? Number.MAX_SAFE_INTEGER : 500;
  const limit=integer(args.limit ?? defaultLimit,'review content limit',1,Number.MAX_SAFE_INTEGER);
  if (args.path !== undefined) path(args.path);
  else {
    if (part !== 'diff') fail('Batch review content only supports diff');
    if (args.group !== undefined) text(args.group,'review group');
    else {
      if (!Array.isArray(args.paths) || args.paths.length < 1 || args.paths.length > limits.page
          || new Set(args.paths).size !== args.paths.length) fail('Select 1 to 100 distinct review paths');
      args.paths.forEach(path);
    }
  }

  const {value}=await head(args.review_id,await identity());
  const scope=await manifest(value);
  if (args.path !== undefined) {
    const file=scope.files.find(file=>file.path === args.path);
    if (!file) fail('Review file is outside the scope');
    const budget=part === 'diff' ? limits.output-deliveryBytes : limits.output;
    const page=await readPage(value,file,part,offset,limit,budget);
    if (!page) fail('Review source line exceeds the output budget');
    return {...page,...delivered(value.id,[page])};
  }
  const group=args.group === undefined ? null : scope.groups.find(group=>group.id === args.group);
  if (args.group !== undefined && !group) fail('Review group is outside the scope');
  const byPath=new Map(scope.files.map(file=>[file.path,file]));
  const files=(group ? group.files : args.paths).map(name=>{
    const file=byPath.get(name);
    if (!file) fail('Review file is outside the scope');
    return file;
  });
  const result=await diffs(value,files,offset,limit,limits.modelOutput-deliveryBytes);
  if (!result || result.next === offset) fail('Review file exceeds the batch output budget; read its path separately');
  return {...result,...delivered(value.id,result.files)};
}
