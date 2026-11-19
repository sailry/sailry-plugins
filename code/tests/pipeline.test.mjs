import assert from 'node:assert/strict';
import test from 'node:test';
import {pipeline} from '../dev.sailry.platform/host/pipeline.js';

const revision = 'a'.repeat(64);
const steps = [{operation:'code.search',arguments:{name:'entry'}},
  {operation:'files.read_lines',arguments:{limit:2},from_previous:{path:'/symbols/0/path',
    offset:'/symbols/0/range/start_line',expected_revision:'/symbols/0/file_revision'}}];
const input = {steps,select:'/lines/0/text'};
const found = {data:{partial:true,symbols:[{path:'main.go',file_revision:revision,range:{start_line:7}}]}};

test('only the selected final data and incomplete step numbers reach the model',() => {
  const first = pipeline({arguments:input,step:0});
  assert.deepEqual(first.call,{operation:'code.search',arguments:{name:'entry',limit:8}});
  const second = pipeline({arguments:input,step:1,state:first.state,outcome:found});
  assert.deepEqual(second.call,{operation:'files.read_lines',arguments:{path:'main.go',limit:2,offset:7,expected_revision:revision}});
  assert.deepEqual(second.state,{partial_steps:[1]});
  assert.deepEqual(pipeline({arguments:input,step:2,state:second.state,outcome:{data:{lines:[{text:'func entry() {}'}]}}}),
    {result:{value:'func entry() {}',partial_steps:[1]}});
});

test('rejects independent steps, unsupported operations, missing bindings and oversized final selections',() => {
  for (const next of [{operation:'files.read_lines',arguments:{path:'known.go'}},
    {operation:'files.write',from_previous:{path:'/symbols/0/path'}},
    {operation:'files.read_lines',from_previous:{path:'/symbols/3/path'}},
    {operation:'files.read_lines',from_previous:{worktree:'/symbols/0/path'}},
    {operation:'files.read_lines',from_previous:{path:'/symbols/length'}}]) {
    assert.equal(pipeline({arguments:{steps:[steps[0],next]},step:1,outcome:found}).result.isError,true);
  }
  assert.equal(pipeline({arguments:input,step:2,outcome:{data:{lines:[{text:'界'.repeat(6000)}]}}}).result.isError,true);
  const failed = {isError:true,error:{code:'revision_conflict'}};
  assert.deepEqual(pipeline({arguments:input,step:2,outcome:failed}),{result:failed});
});
