import {callId} from 'sailry/sdk';
import {change} from './git.js';
import {fail, fields, identifier, integer, limits, path, revision, text} from './policy.js';
import {head, key, manifest, open, transaction, write} from './records.js';

export function anchor(lines, snippet, side) {
  if (!['new','old'].includes(side)) fail('Invalid finding side');
  const parts = snippet.endsWith('\n') ? snippet.slice(0,-1).split('\n') : snippet.split('\n');
  if (!parts.length) fail('Snippet must use LF-separated source lines');
  const number = side === 'new' ? 'new_line' : 'old_line';
  const changed = side === 'new' ? 'added' : 'deleted';
  const mapped = lines.filter(line => line[number] != null);
  const matches = [];
  for (let offset = 0; offset + parts.length <= mapped.length; offset++) {
    const window = mapped.slice(offset,offset+parts.length);
    if (window.some((line,index) => line.text !== parts[index]
        || line[number] !== window[0][number]+index)) continue;
    matches.push(window);
  }
  if (matches.length !== 1) fail(matches.length ? 'Finding snippet is ambiguous' : 'Finding snippet is absent');
  const target = matches[0].find(line => line.kind === changed);
  if (!target) fail('Finding snippet does not anchor a changed line');
  return target[number];
}
export async function prepare(input, actor) {
  const args = fields(input,['review_id','path','revision','side','line','snippet','severity','title','explanation','evidence'],
    ['review_id','path','revision','side','line','snippet','severity','title','explanation','evidence']);
  identifier(args.review_id);
  path(args.path);
  revision(args.revision);
  integer(args.line,'finding line',1,Number.MAX_SAFE_INTEGER);
  text(args.snippet,'finding snippet');
  text(args.title,'finding title');
  text(args.explanation,'finding explanation');
  text(args.evidence,'finding evidence');
  if (!['P0','P1','P2','P3'].includes(args.severity)) fail('Invalid finding severity');
  const current = await head(args.review_id,actor);
  open(current.value);
  const scope = await manifest(current.value);
  const file = scope.files.find(file => file.path === args.path);
  if (!file) fail('Finding file is outside the review scope');
  if (file.revision !== args.revision) fail('Finding uses a stale file revision','revision_conflict');
  const diff = await change(actor.worktree,current.value.snapshot,file,true);
  if (diff.binary || diff.skip_reason) fail('Finding file cannot be reviewed','revision_conflict');
  const line = anchor(diff.lines,args.snippet,args.side);
  const id = identifier(callId());
  if (current.value.findings.includes(id)) fail('Finding was already recorded','conflict');
  const finding = {id,path:args.path,revision:file.revision,side:args.side,line,
    snippet:args.snippet,severity:args.severity,title:args.title,explanation:args.explanation,
    evidence:args.evidence,rule:file.rule,reporter:actor.session};
  current.value.findings.push(id);
  return transaction([write(key(args.review_id,'head'),current.value,current.record.revision),
    write(key(args.review_id,`finding/${id}`),{v:1,kind:'finding',finding})],
    {review_id:args.review_id,finding});
}
