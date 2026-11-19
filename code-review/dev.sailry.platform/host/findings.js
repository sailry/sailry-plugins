import {pages} from './content.js';
import {fail, fields, identifier, integer, limits, path, result, revision, size, text} from './policy.js';
import {head, key, manifest, open, transaction, write} from './records.js';

const required = ['path','revision','side','line','severity','title','explanation','evidence'];
const optional = [...required,'snippet'];

function validate(args) {
  fields(args,optional,required);
  path(args.path);
  revision(args.revision);
  integer(args.line,'finding line',1,Number.MAX_SAFE_INTEGER);
  if (!['new','old'].includes(args.side)) fail('Invalid finding side');
  if (Object.hasOwn(args,'snippet')) text(args.snippet,'finding snippet');
  text(args.title,'finding title');
  text(args.explanation,'finding explanation');
  text(args.evidence,'finding evidence');
  if (!['P0','P1','P2','P3'].includes(args.severity)) fail('Invalid finding severity');
}

function anchor({snippet,side,line}) {
  const number = side === 'new' ? 'new_line' : 'old_line';
  const changed = side === 'new' ? 'added' : 'deleted';
  const parts = snippet === undefined ? null : (snippet.endsWith('\n') ? snippet.slice(0,-1) : snippet).split('\n');
  const window = [];
  let matches = 0, selected = null;
  return {
    scan(row) {
      if (row[number] == null) return;
      if (parts === null) {
        if (row[number] !== line) return;
        matches++;
        selected = row.kind === changed ? line : null;
        return;
      }
      window.push(row);
      if (window.length > parts.length) window.shift();
      if (window.length !== parts.length || window.some((entry,index) => entry.text !== parts[index]
          || entry[number] !== window[0][number]+index)) return;
      matches++;
      selected = window.find(entry => entry.kind === changed)?.[number] ?? null;
    },
    resolve() {
      const label = parts === null ? 'line' : 'snippet';
      if (matches !== 1) fail(`Finding ${label} is ${matches ? 'ambiguous' : 'absent'}`);
      if (selected === null) fail(`Finding ${label} does not anchor a changed line`);
      return selected;
    },
  };
}

export async function prepare(input, actor, intent) {
  const batch = input != null && Object.hasOwn(input,'findings');
  let items;
  if (batch) {
    fields(input,['review_id','findings'],['review_id','findings']);
    items = input.findings;
    if (!Array.isArray(items) || !items.length || items.length > 63) fail('Expected 1 to 63 findings');
  } else {
    const {review_id,...args} = fields(input,['review_id',...optional],['review_id',...required]);
    validate(args);
    items = [args];
  }
  const reviewId = identifier(input.review_id);
  const call = identifier(intent);
  const current = await head(reviewId,actor);
  open(current.value);
  const scope = await manifest(current.value);
  const files = new Map(scope.files.map(file => [file.path,file]));
  const recorded = new Set(current.value.findings);
  const candidates = [], byFile = new Map(), results = new Array(items.length);
  const rejected = error => {
    if (!batch || !['invalid_request','not_found','revision_conflict','conflict'].includes(error.code)) throw error;
    return result(error);
  };

  for (const [index,args] of items.entries()) {
    try {
      if (batch) validate(args);
      const file = files.get(args.path);
      if (!file) fail('Finding file is outside the review scope');
      if (file.revision !== args.revision) fail('Finding uses a stale file revision','revision_conflict');
      const id = batch ? `${call}-${index+1}` : call;
      if (recorded.has(id)) fail('Finding was already recorded','conflict');
      const candidate = {args,file,id,index,anchor:anchor(args)};
      candidates.push(candidate);
      if (!byFile.has(file)) byFile.set(file,[]);
      byFile.get(file).push(candidate);
    } catch (error) {
      results[index] = rejected(error);
    }
  }

  for (const [file,entries] of byFile) {
    try {
      for await (const page of pages(current.value,file,'diff')) {
        for (const row of page.rows) for (const entry of entries) entry.anchor.scan(row);
      }
    } catch (error) {
      const failure = rejected(error);
      for (const entry of entries) results[entry.index] = failure;
    }
  }

  const operations = [];
  const headKey = key(reviewId,'head');
  let headRoom = limits.value - size(current.value);
  // Reserve enough space for the entire response and the growth of the head record.
  let transactionRoom = limits.transaction - limits.output - size([write(headKey,current.value,current.record.revision)]);
  for (const {args,file,id,index,anchor:location} of candidates) {
    if (results[index]) continue;
    try {
      const line = location.resolve();
      const finding = {id,path:args.path,revision:file.revision,side:args.side,line,
        ...(args.snippet === undefined ? {} : {snippet:args.snippet}),severity:args.severity,title:args.title,
        explanation:args.explanation,evidence:args.evidence,rule:file.rule,reporter:actor.session};
      const single = {review_id:reviewId,finding};
      if (size(single) > limits.output) fail('Finding exceeds the bounded output budget');
      const operation = write(key(reviewId,`finding/${id}`),{v:1,kind:'finding',finding});
      const headGrowth = size(id)+1;
      const cost = size(operation)+headGrowth+1;
      if (headGrowth > headRoom || cost > transactionRoom) fail('Finding exceeds the remaining storage budget');
      headRoom -= headGrowth;
      transactionRoom -= cost;
      current.value.findings.push(id);
      operations.push(operation);
      results[index] = batch ? {id,line} : single;
    } catch (error) {
      results[index] = rejected(error);
    }
  }
  const output = batch ? {review_id:reviewId,results} : results[0];
  if (!operations.length) return {result:output};
  return transaction([write(headKey,current.value,current.record.revision),...operations],output);
}
