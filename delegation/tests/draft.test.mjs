import assert from 'node:assert/strict';
import test from 'node:test';
import {catalog,create,source,selectModel,profile,efforts,errorKey,applyResearch,RESEARCH_INSTRUCTIONS} from '../dev.sailry.platform/desktop/draft.js';

const models = [
  {kind:'provider',id:'provider-a/plain',provider:'First',model:'plain',default:false,reasoning:false,efforts:[],default_effort:'default'},
  {kind:'provider',id:'provider-a/vendor/reasoned',provider:'First',model:'vendor/reasoned',default:true,reasoning:true,efforts:['default','low','high'],default_effort:'high'},
  {kind:'provider',id:'provider-b/other',provider:'Second',model:'other',default:true,reasoning:true,efforts:[{budget:2048},{budget:4096}],default_effort:{budget:2048}},
  {kind:'unsupported',id:'unsupported/private',provider:'Unavailable',model:'private',default:false,reasoning:false,efforts:[],default_effort:'none'}
];
const fields = {key:'reviewer',name:'Reviewer',turns:'',instructions:'Review changes'};
const original = {id:'role-one',revision:9,key:'old',name:'Original',description:'Preserved description',read_only:true,
  appearance:{icon:'ai',color:'blue'},model:{provider:'missing',model:'old/model',effort:'high'},
  max_turns:8,skills:['retained-skill'],instructions:'Original instructions'};

test('fixed sources use first-provider defaults and preserve complete model identifiers',() => {
  const state = create(null,'new',catalog({models:[models[2],...models.slice(0,2),models[3]]}));
  source(state,true);
  assert.deepEqual(state.model,{provider:'provider-a',model:'vendor/reasoned',effort:'high'});
  assert.equal(state.models.length,3);
  source(state,false); assert.equal(state.model,null);
  state.models[1].default = false; source(state,true);
  assert.deepEqual(state.model,{provider:'provider-a',model:'plain',effort:null});
});

test('model changes retain supported efforts and use the native initial choice otherwise',() => {
  const state = create(null,'new',catalog({models})); source(state,true);
  state.model.effort = 'low'; selectModel(state,state.models[1]); assert.equal(state.model.effort,'low');
  selectModel(state,state.models[2]); assert.deepEqual(state.model.effort,{budget:2048});
  state.model.effort = {budget:4096}; selectModel(state,state.models[2]);
  assert.deepEqual(state.model.effort,{budget:4096});
  assert.deepEqual(efforts(state),[null,{budget:2048},{budget:4096}]);
  const empty = {...state.models[1],efforts:[],default_effort:'default'};
  selectModel(state,empty); assert.equal(state.model.effort,'default');
  selectModel(state,state.models[0]); assert.equal(state.model.effort,null);
});

test('editing preserves unavailable model identity and unexposed description and skills',() => {
  const state = create(original,'unused',catalog({models}));
  const result = profile(state,{...fields,turns:' 25 ',instructions:'Changed'});
  assert.equal(result.id,'role-one'); assert.equal(result.revision,9);
  assert.deepEqual(result.model,original.model); assert.equal(result.description,original.description);
  assert.deepEqual(result.skills,original.skills); assert.equal(result.max_turns,25);
  assert.equal(original.instructions,'Original instructions');
  assert.equal(result.read_only,true);
  state.readOnly = false; assert.equal(profile(state,fields).read_only,false);
  source(state,false); assert.equal(profile(state,fields).model,null);
});

test('new roles inherit the parent write capability until explicitly restricted',() => {
  const state = create(null,'new',[]);
  assert.equal(state.readOnly,false);
  assert.equal(profile(state,fields).read_only,false);
  state.readOnly = true;
  assert.equal(profile(state,fields).read_only,true);
});

test('research drafts inherit the model and bound read-only work',() => {
  const state = create(null,'new-research',catalog({models}));
  source(state,true);
  const values = applyResearch(state,'Research','Investigate public sources');
  const result = profile(state,values);
  assert.equal(result.id,'new-research');
  assert.equal(result.revision,0);
  assert.equal(result.read_only,true);
  assert.equal(result.model,null);
  assert.equal(state.fixed,false);
  assert.equal(result.max_turns,8);
  assert.deepEqual(result.skills,['web-search:research']);
  assert.equal(result.instructions,RESEARCH_INSTRUCTIONS);
  assert.match(result.instructions,/inherited permissions/);
  assert.equal(applyResearch(create(original,'unused',[]),'Research','Description'),null);
  assert.deepEqual(original.skills,['retained-skill']);
});

test('validates exact keys, UTF-8 and u32 turn limits before command preparation',() => {
  const state = create(null,'new',[]);
  for (const key of ['', 'UPPER', '-leading', 'trailing-', 'with space']) {
    assert.throws(() => profile(state,{...fields,key}),/role_invalid/);
  }
  for (const turns of ['0','-1','1.5','4294967296','2x']) {
    assert.throws(() => profile(state,{...fields,turns}),/role_invalid/);
  }
  assert.equal(profile(state,{...fields,key:' a ',name:' Name ',turns:'+4294967295'}).max_turns,4294967295);
  assert.equal(profile(state,{...fields,key:'x'.repeat(129),name:'界'.repeat(43)}).key,'x'.repeat(129));
  assert.equal(profile(state,{...fields,instructions:'界'.repeat(5462)}).instructions,'界'.repeat(5462));
  source(state,true); assert.throws(() => profile(state,fields),/role_invalid/);
});

test('retains native conflict, unavailable, and uncertain distinctions',() => {
  assert.equal(errorKey('revision_conflict'),'role_conflict');
  assert.equal(errorKey('not_found'),'role_conflict');
  assert.equal(errorKey('conflict'),'role_duplicate');
  assert.equal(errorKey('not_configured'),'role_model_unavailable');
  assert.equal(errorKey('outcome_unknown'),'role_unknown');
  assert.equal(errorKey('busy'),'role_capacity');
});
