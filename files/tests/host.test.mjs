import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const root = new URL('../',import.meta.url);
const manifest = JSON.parse(await readFile(new URL('plugin.json',root),'utf8'));
const extension = manifest.extensions['dev.sailry.platform'];
const source = (await readFile(new URL('dev.sailry.platform/host/main.js',root),'utf8')).replace(/^export /gm,'');
const host = vm.runInNewContext(`${source}\n({list,read,write,edit,remove,move,mkdir,find,search,office})`);
const localeSource = (await readFile(new URL('dev.sailry.platform/host/locales.js',root),'utf8')).replace(/^export /gm,'');
const captions = vm.runInNewContext(`${localeSource}\ncaptions`);
const plain = value => JSON.parse(JSON.stringify(value));
const tool = name => extension.tools.find(tool => tool.name === name);

test('tool declarations preserve operations and unformatted native outputs', () => {
  const expected = [
    ['list_directory','list','files.list','summary'],
    ['read_file','read','files.read','summary'],
    ['write_file','write','files.write','details'],
    ['edit_file','edit','files.edit','details'],
    ['delete_file','remove','files.delete','summary'],
    ['move_file','move','files.move','summary'],
    ['create_directory','mkdir','files.mkdir','summary'],
    ['find_files','find','files.find','summary'],
    ['search_files','search','files.search','summary'],
    ['read_office','office','office.read','summary'],
  ];
  assert.equal(manifest.name,'files');
  assert.deepEqual(extension.tools.map(tool => tool.name),expected.map(([name]) => name));
  assert.deepEqual(extension.actions,['files.read','files.write']);
  assert.deepEqual(extension.host.handlers,expected.map(([,handler]) => handler));
  for (const [name,handler,operation,presentation] of expected) {
    const declaration = tool(name);
    assert.equal(declaration.handler.name,handler);
    assert.equal(declaration.handler.operation,operation);
    assert.equal(declaration.presentation,presentation);
    assert.deepEqual(declaration.contexts,['plugin','workspace'],
      'file tools allow project and assistant worktrees, without database or SSH resources');
    assert.equal(declaration.handler.result,undefined,'the entire native Output must bypass the VM');
    assert.equal(declaration.handler.parameters.additionalProperties,false);
    assert.equal(typeof host[handler],'function');
    for (const ownership of ['node','worktree','session','turn']) {
      assert.equal(declaration.handler.parameters.properties[ownership],undefined);
    }
    assert.ok(declaration.display.locales['zh-CN']);
    assert.match(declaration.display.icon.svg,/viewBox="0 0 24 24"/);
  }
  assert.match(tool('write_file').description,/conflict requires reading the current file/);
  assert.match(tool('read_file').description,/do not treat it as the whole file/);
  assert.equal(tool('get_office_runtime'),undefined);
  assert.match(tool('read_office').description,/including continuations of long parts/);
});

test('directory schema and pagination retain cursor identity and root spelling', () => {
  const schema = tool('list_directory').handler.parameters;
  assert.deepEqual(schema.required,[]);
  assert.deepEqual(schema.properties.cursor.type,['object','null']);
  assert.deepEqual(schema.properties.cursor.required,['revision','directory','name']);
  assert.equal(schema.properties.cursor.additionalProperties,false);
  assert.equal(schema.properties.cursor.properties.revision.minLength,1);
  assert.equal(schema.properties.cursor.properties.name.minLength,1);
  assert.deepEqual(plain(host.list({})),{path:'',after:null});
  assert.deepEqual(plain(host.list({path:'.',cursor:null})),{path:'',after:null});
  const cursor = {revision:'captured-directory-revision',directory:true,name:'资料'};
  const args = {path:'nested/资料',cursor};
  const prepared = host.list(args);
  assert.equal(prepared.after,cursor);
  assert.deepEqual(plain(prepared),{path:'nested/资料',after:cursor});
  assert.deepEqual(args,{path:'nested/资料',cursor});
  for (const path of ['./','..',' a/b ','资料.txt']) assert.equal(host.list({path}).path,path);
});

test('writes retain exact text and optimistic revision semantics', () => {
  const schema = tool('write_file').handler.parameters;
  assert.deepEqual(schema.required,['path','text','expected_revision']);
  assert.deepEqual(schema.properties.expected_revision.type,['string','null']);
  const text = '  资料 🙂\n\\literal\t\u0001';
  const current = 'a'.repeat(64);
  for (const expected_revision of [null,current]) {
    const args = Object.freeze({path:'nested/资料.txt',text,expected_revision});
    assert.deepEqual(plain(host.write(args)),args);
  }
  // The original serde Option accepts omitted revisions, although the schema asks for one.
  assert.deepEqual(plain(host.write({path:'new.txt',text:''})),{
    path:'new.txt',text:'',expected_revision:null,
  });
  assert.equal(host.write({path:'text.txt',text:'\u0001'.repeat(128 * 1024)}).text.length,128 * 1024);
  assert.deepEqual(plain(host.read({path:'nested/资料.txt'})),{path:'nested/资料.txt',offset:0,limit:200});
});

test('search defaults keep original expressions and globs without interpreting them', () => {
  const schema = tool('search_files').handler.parameters;
  assert.deepEqual(schema.required,['query']);
  assert.equal(schema.properties.query.minLength,1);
  assert.equal(schema.properties.globs.maxItems,64);
  assert.equal(schema.properties.globs.items.maxLength,4096);
  assert.deepEqual(plain(host.search({query:' needle\n'})),{
    query:' needle\n',regex:false,case_sensitive:false,globs:[],path:'',mode:'content',context:0,type:null,limit:200,offset:0,multiline:false,
  });
  const globs = ['**/*.rs','资料/*.txt','**/*.rs'];
  const args = {query:'^a.*[中]$',regex:true,case_sensitive:true,globs};
  assert.deepEqual(plain(host.search(args)),{path:'',mode:'content',context:0,type:null,limit:200,offset:0,multiline:false,...args});
  assert.equal(host.search(args).globs,globs);
  assert.deepEqual(args,{query:'^a.*[中]$',regex:true,case_sensitive:true,globs});
});

test('Office inspection retains section offsets and defaults', () => {
  assert.deepEqual(tool('read_office').handler.parameters,{
    $schema:'https://json-schema.org/draft/2020-12/schema',title:'Read',type:'object',
    properties:{path:{type:'string'},offset:{
      type:'integer',format:'uint',minimum:0,default:0,
      description:'Zero-based section offset. Long document parts continue in subsequent sections.',
    }},required:['path'],additionalProperties:false,
  });
  assert.deepEqual(plain(host.office({path:'报告.docx'})),{path:'报告.docx',offset:0});
  assert.deepEqual(plain(host.office({path:'book.xlsx',offset:41})),{path:'book.xlsx',offset:41});
});

test('invalid argument shapes fail before requesting an operation', () => {
  const examples = {
    list:{path:'.'},read:{path:'file.txt'},write:{path:'file.txt',text:'x',expected_revision:null},
    edit:{path:'file.txt',old_text:'x',new_text:'y',expected_revision:'a'.repeat(64)},
    remove:{path:'file.txt',expected_revision:'a'.repeat(64)},
    move:{path:'file.txt',destination:'new.txt',expected_revision:'a'.repeat(64)},
    mkdir:{path:'folder'},
    find:{globs:['**/*.txt']},search:{query:'x'},office:{path:'book.xlsx'},
  };
  for (const [name,valid] of Object.entries(examples)) {
    for (const args of [null,[],true,'path',42,...['worktree','session','node','turn','unexpected'].map(key => ({...valid,[key]:'foreign'}))]) {
      const result = host[name](args);
      assert.equal(result.isError,true,`${name}: ${JSON.stringify(args)}`);
      assert.equal(result.error.code,'invalid_request');
      assert.equal(result.path,undefined);
    }
  }
  const invalid = {
    list:[{path:null},{cursor:[]},{cursor:{revision:'r',directory:'yes',name:'n'}},{cursor:{revision:'r',directory:true}},{cursor:{revision:'r',directory:true,name:'n',worktree:'foreign'}}],
    read:[{}, {path:4},{path:'a',offset:-1},{path:'a',limit:0},{path:'a',limit:2001},{path:'a',offset:1.5}],
    edit:[{}, {path:'a',old_text:'',new_text:'y',expected_revision:'a'.repeat(64)},{path:'a',old_text:'x',new_text:'y',expected_revision:null}],
    remove:[{}, {path:'a',expected_revision:null},{path:'a',expected_revision:'old'}],
    move:[{}, {path:'a',expected_revision:'a'.repeat(64)},{path:'a',destination:1,expected_revision:'a'.repeat(64)}],
    mkdir:[{}, {path:null}],
    find:[{}, {globs:[]},{globs:['']},{globs:[4]}],
    write:[{path:'a'}, {path:'a',text:[]}, {path:'a',text:'x',expected_revision:4}],
    search:[{}, {query:4}, {query:'x',regex:null}, {query:'x',case_sensitive:1}, {query:'x',globs:'*'}, {query:'x',globs:[4]}],
    office:[{}, {path:'a',offset:null}, {path:'a',offset:-1}, {path:'a',offset:1.5}, {path:'a',offset:Number.MAX_SAFE_INTEGER + 1}],
  };
  for (const [name,examples] of Object.entries(invalid)) {
    for (const args of examples) assert.equal(host[name](args).error.code,'invalid_request',`${name}: ${JSON.stringify(args)}`);
  }
});

test('captured display selectors retain path and first-line query presentation', () => {
  assert.deepEqual(tool('search_files').display.input.summary,{path:'/query',code:true});
  for (const name of ['read_file','write_file','read_office']) {
    assert.deepEqual(tool(name).display.input.summary,{path:'/path',code:true});
  }
  assert.deepEqual(tool('write_file').display.input.target,{path:'/path'});
  assert.ok(extension.host.resources.includes('dev.sailry.platform/host/locales.js'));
  for (const key of ['approval_create_file','approval_replace_file']) {
    assert.match(captions[key].label,/%\{path\}/);
    assert.match(captions[key].locales['zh-CN'],/%\{path\}/);
  }
  for (const key of ['tool_file_written','tool_partial','tool_empty']) {
    assert.ok(captions[key].label);
    assert.ok(captions[key].locales['zh-CN']);
  }
});

test('result recipes refer to original data and preserve file-specific choices', () => {
  const reference = (source,path) => ({source,path});
  assert.deepEqual(tool('read_file').display.output.paths,{value:reference('arguments','/path')});
  assert.deepEqual(tool('search_files').display.output.paths,{
    value:reference('result','/data/matches'),item:'/path',
  });
  assert.deepEqual(tool('write_file').display.output.body.text,reference('arguments','/text'));
  assert.deepEqual(tool('write_file').display.output.body.diff,{
    format:'added',when:{any:[{value:reference('arguments','/expected_revision'),equals:null}]},
  });
  const prompts = tool('write_file').display.approval;
  assert.deepEqual(prompts[0].when,{any:[{value:reference('arguments','/expected_revision'),equals:null}]});
  assert.equal(prompts[0].message.label,'Create %{path}');
  assert.equal(prompts[1].message.label,'Replace %{path}');
  assert.deepEqual(prompts[1].values.path,reference('arguments','/path'));
  const office = tool('read_office').display.output.preview.parts[0].rows;
  assert.deepEqual(office.value,reference('result','/data/sections'));
  assert.deepEqual(office.text.parts,[{value:reference('item','/text')}]);
  assert.equal(office.separator,'\n\n');
  const partial = tool('list_directory').display.output.notices[0];
  assert.deepEqual(partial.when.any,[
    {value:reference('result','/data/truncated'),equals:true},
    {value:reference('result','/data/unsupported_names'),equals:0,negate:true},
  ]);
});


test('line pages retain offsets and exact edit fragments', () => {
  assert.deepEqual(plain(host.read({path:'large.txt',offset:3000,limit:25})),{path:'large.txt',offset:3000,limit:25});
  const args = {path:'large.txt',old_text:'old\r\n',new_text:'new\r\n',expected_revision:'a'.repeat(64)};
  assert.deepEqual(plain(host.edit(args)),args);
  assert.deepEqual(tool('edit_file').handler.parameters.required,['path','expected_revision']);
  assert.equal(tool('edit_file').display.approval[0].message.label,'Edit %{path}');
  assert.deepEqual(plain(host.find({globs:['**/*.rs','src/**/mod.rs']})),{globs:['**/*.rs','src/**/mod.rs'],path:'',limit:500,offset:0});
  assert.equal(tool('find_files').handler.operation,'files.find');
  assert.equal(tool('read_file').handler.parameters.properties.offset.minimum,0);
  assert.equal(tool('read_file').handler.parameters.properties.limit.maximum,2000);
  assert.deepEqual(tool('read_file').display.output.notices[0].when.any,[
    {value:{source:'result',path:'/data/next_offset'},equals:null,negate:true},
    {value:{source:'result',path:'/data/offset'},equals:0,negate:true},
  ]);
});

test('batch edits preserve atomic arguments and enforce exclusive forms', () => {
  const expected_revision = 'a'.repeat(64);
  const edits = Object.freeze([
    Object.freeze({old_text:'first\r\n',new_text:'changed\r\n'}),
    Object.freeze({old_text:'🙂',new_text:'中文',replace_all:true}),
  ]);
  const arguments_ = Object.freeze({path:'file.txt',edits,expected_revision});
  assert.deepEqual(plain(host.edit(arguments_)),arguments_);
  assert.equal(host.edit(arguments_).edits,edits);
  assert.deepEqual(plain(host.edit({path:'file.txt',old_text:'old',new_text:'new',replace_all:true,expected_revision})),{
    path:'file.txt',old_text:'old',new_text:'new',replace_all:true,expected_revision,
  });
  for (const shape of [
    {edits,old_text:'first',new_text:'changed'}, {edits,old_text:'first'}, {edits,new_text:'changed'},
    {edits,replace_all:true}, {edits:[]}, {edits:null}, {edits:Array(129).fill(edits[0])},
    {edits:[{old_text:'',new_text:'changed'}]}, {edits:[{old_text:'first',new_text:'changed',replace_all:1}]},
    {edits:[{old_text:'first',new_text:'changed',path:'other.txt'}]},
  ]) {
    const result = host.edit({path:'file.txt',expected_revision,...shape});
    assert.equal(result.error.code,'invalid_request',JSON.stringify(shape));
  }
  const schema = tool('edit_file').handler.parameters;
  assert.equal(schema.properties.edits.maxItems,128);
  assert.equal(schema.properties.edits.items.additionalProperties,false);
  assert.deepEqual(schema.properties.edits.items.required,['old_text','new_text']);
  assert.equal(schema.oneOf.length,2);
  assert.match(extension.instructions,/original content/);
  assert.match(tool('edit_file').description,/fail without writing any change/);
});

test('file mutations retain revisions and explicit destinations', () => {
  const expected_revision = 'b'.repeat(64);
  assert.deepEqual(plain(host.remove({path:'note.txt',expected_revision})),{path:'note.txt',expected_revision});
  assert.deepEqual(plain(host.move({path:'note.txt',destination:'nested/note.txt',expected_revision})),{
    path:'note.txt',destination:'nested/note.txt',expected_revision,
  });
  assert.deepEqual(plain(host.mkdir({path:'nested'})),{path:'nested'});
  assert.match(tool('delete_file').description,/Trash/);
  assert.match(tool('move_file').description,/never overwrite/);
  assert.match(tool('create_directory').description,/existing directory is unchanged/);
  assert.deepEqual(tool('delete_file').handler.parameters.required,['path','expected_revision']);
  assert.deepEqual(tool('move_file').handler.parameters.required,['path','destination','expected_revision']);
});


test('scoped search modes and discovery pages preserve arguments', () => {
  const args = {query:'first.*second',regex:true,case_sensitive:true,globs:['src/**'],path:'src',
    mode:'count',context:5,type:'python',limit:11,offset:200,multiline:true};
  assert.deepEqual(plain(host.search(Object.freeze(args))),args);
  assert.equal(host.search({...args,path:'.'}).path,'');
  assert.deepEqual(plain(host.find({globs:['**/*.rs'],path:'src',limit:1,offset:500})),{
    globs:['**/*.rs'],path:'src',limit:1,offset:500,
  });
  const schema = tool('search_files').handler.parameters;
  assert.deepEqual(schema.properties.mode.enum,['content','files','count']);
  assert.equal(schema.properties.context.maximum,5);
  assert.equal(schema.properties.limit.maximum,200);
  assert.equal(tool('find_files').handler.parameters.properties.limit.maximum,500);
  assert.match(tool('search_files').description,/ripgrep/);
  assert.match(tool('search_files').description,/Partial|Incomplete/);
  for (const args of [
    {query:'x',mode:'all'}, {query:'x',context:6}, {query:'x',context:-1}, {query:'x',context:1.5},
    {query:'x',limit:201}, {query:'x',limit:0}, {query:'x',offset:-1}, {query:'x',offset:1.5},
    {query:'x',multiline:'yes'}, {query:'x',type:1}, {query:'x',path:null}, {query:''},
  ]) assert.equal(host.search(args).error.code,'invalid_request');
  for (const args of [
    {globs:['*'],path:null}, {globs:['*'],limit:0}, {globs:['*'],limit:501},
    {globs:['*'],offset:-1}, {globs:['*'],offset:0.5},
  ]) assert.equal(host.find(args).error.code,'invalid_request');
});
