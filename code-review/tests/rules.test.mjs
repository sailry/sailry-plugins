import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {entries as generated, rules as metadata} from '../dev.sailry.platform/host/rules.js';
import {file,fixture,uuid} from './support.mjs';

const skill = new URL('../skills/code-review/',import.meta.url);
const rules = new URL('rules/',skill);
const index = await readFile(new URL('index.md',rules),'utf8');
const entries = [...index.matchAll(/^\| `([^`]+)` \| ([\w.]+) \|$/gm)].map(([,pattern,rule]) => ({pattern,rule}));
const files = (await readdir(rules)).filter(name => name !== 'index.md');
const manifest = JSON.parse(await readFile(new URL('../plugin.json',import.meta.url),'utf8'));
const extension = manifest.extensions['dev.sailry.platform'];
const reader = extension.tools.find(tool => tool.name === 'review_read_change');

function pageArgs(scope,worktree = null) {
  const source = scope.files[0];
  return {worktree,snapshot:scope.snapshot,path:source.path,expected_metadata_revision:source.metadata_revision,
    expected_revision:source.revision,offset:0,limit:1};
}

test('index entries reference bundled rules', () => {
  assert.ok(entries.length > 0);
  for (const {rule} of entries) assert.ok(files.includes(rule),rule);
  assert.equal(new Set(entries.map(entry => entry.pattern)).size,entries.length);
});

test('every bundled rule is reachable', () => {
  const reachable = new Set([...entries.map(entry => entry.rule),'default.md','objc.md']);
  assert.deepEqual(files.filter(name => !reachable.has(name)),[]);
  assert.match(index,/Use `default\.md` when no pattern matches/);
});

test('workflow patterns precede generic YAML', () => {
  const position = pattern => entries.findIndex(entry => entry.pattern === pattern);
  assert.ok(position('.github/workflows/**/*.{yaml,yml}') < position('.github/**/*.{yaml,yml}'));
  assert.ok(position('.github/**/*.{yaml,yml}') < position('**/*.{yaml,yml}'));
});

test('skill loads the index through skill resources', async () => {
  const text = await readFile(new URL('SKILL.md',skill),'utf8');
  assert.match(text,/Read `rules\/index\.md` with `read_skill_resource`/);
});


test('generated metadata preserves rule order and original hashes', async () => {
  assert.deepEqual(generated,entries);
  assert.equal(files.length,54);
  assert.deepEqual(Object.keys(metadata).sort(),files.slice().sort());
  for (const file of files) {
    const body = await readFile(new URL(file,rules));
    assert.deepEqual(metadata[file],{path:`rules/${file}`,sha256:createHash('sha256').update(body).digest('hex')});
  }
});

test('frozen review targets Code with native Git support', () => {
  assert.equal(manifest.version,'0.3.1');
  assert.equal(extension.api_version,'v1');
  assert.equal(extension.min_sailry_version,'0.2.14');
  assert.deepEqual(extension.products,['code']);
  assert.deepEqual(extension.requires_modules,['git']);
});

test('mutating tools declare atomic storage flows', () => {
  const tools = extension.tools.filter(tool => tool.handler && !tool.handler.read_only);
  assert.deepEqual(tools.map(tool => tool.name),['review_scope','report_finding','review_complete']);
  for (const tool of tools) {
    assert.deepEqual(tool.handler.flow.operations,['storage.transaction']);
  }
  assert.ok(extension.actions.includes('storage.write'));
  assert.ok(extension.instructions.includes('unavailable in Plan mode'));
});

test('the patch reader is a read-only package callback', async () => {
  assert.deepEqual(reader.contexts,['workspace']);
  assert.equal(reader.operation,undefined);
  assert.equal(reader.handler.operation,undefined);
  assert.equal(reader.handler.read_only,true);
  assert.ok(extension.host.handlers.includes(reader.handler.name));
  assert.ok(extension.actions.includes('git.read'));
  const {properties,required} = reader.handler.parameters;
  assert.ok(required.includes('expected_revision'));
  assert.deepEqual(properties.expected_revision,{type:'string',minLength:1,maxLength:256});
  const text = await readFile(new URL('SKILL.md',skill),'utf8');
  assert.match(text,/this package's `review_read_change` tool/);
  assert.match(text,/strong `revision` as `expected_revision`/);
  assert.match(text,/rejects a missing or empty frozen revision/);
  assert.doesNotMatch(text,/`(?:read_git_change|git_change)`/);
});

test('missing or invalid revisions never reach Git', async () => {
  const git = await fixture();
  const scope = await git.invoke('scope',{});
  const args = pageArgs(scope);
  const before = git.calls.length;
  const invalid = [undefined,null,'',' \t','a\0b','a'.repeat(257)];
  const requests = [
    ...invalid.map(expected_revision => ({...args,expected_revision})),
    {...args,expected_metadata_revision:null},
    {...args,snapshot:{...args.snapshot,metadata_revision:undefined}},
  ];
  for (const request of requests) {
    const outcome = await git.invokeRead(reader.handler.name,request);
    assert.equal(outcome.isError,true);
    assert.equal(outcome.error.code,'invalid_request');
  }
  assert.equal(git.calls.length,before);
});

test('all pages use the same frozen Git revisions', async () => {
  const source = file('src/main.js');
  source.lines.push({kind:'added',old_line:null,new_line:8,text:'return done();'});
  const git = await fixture([source]);
  for (const target of [{kind:'worktree',data:{scope:'staged'}},{kind:'range',data:{base:'b'.repeat(40),head:'a'.repeat(40)}}]) {
    const scope = await git.invoke('scope',{target});
    const args = pageArgs(scope,target.kind === 'worktree' ? null : uuid(4));
    const before = git.calls.length;
    const first = await git.invokeRead(reader.handler.name,args);
    assert.deepEqual(first.lines,[source.lines[0]]);
    assert.equal(first.next,1);
    const second = await git.invokeRead(reader.handler.name,{...args,offset:first.next,limit:2});
    assert.deepEqual(second.lines,[source.lines[1]]);
    assert.equal(second.next,null);
    assert.equal(first.revision,args.expected_revision);
    assert.equal(second.revision,args.expected_revision);
    const request = {...args,worktree:args.worktree ?? git.captured.worktree};
    assert.deepEqual(git.calls.slice(before),[
      {kind:'read_git_change',data:request},
      {kind:'read_git_change',data:{...request,offset:1,limit:2}},
    ]);
  }
});

test('a revision conflict never falls back to discovery', async () => {
  const git = await fixture();
  const scope = await git.invoke('scope',{});
  const args = pageArgs(scope);
  git.change(args.path,{revision:'f'.repeat(64)});
  const before = git.calls.length;
  const outcome = await git.invokeRead(reader.handler.name,args);
  assert.deepEqual(outcome,{isError:true,error:{code:'revision_conflict',message:'File changed'}});
  assert.deepEqual(git.calls.slice(before),[{kind:'read_git_change',data:{...args,worktree:git.captured.worktree}}]);
});
