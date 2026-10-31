import assert from 'node:assert/strict';
import {execute, packageInput, runtimeTest} from '../../scripts/test-host.mjs';

runtimeTest('reads older goal interruptions through the SDK', async () => {
  const input=await packageInput(new URL('../',import.meta.url),'read',{});
  const session=input.context.session;
  const recent='00000000-0000-4000-8000-000000000003';
  const stopped='00000000-0000-4000-8000-000000000004';
  const description='Preserve the complete requested objective';
  const run=(turn,sequence,status)=>({turn,sequence,status,origin:null,error_code:null});
  const history=(runs,before)=>({session,revision:1,runs,queue_revision:0,next_before:before});
  input.replies=[
    {command:{kind:'read_plugin_conversation_value',data:{key:'goal'}},response:{Ok:{kind:'plugin_conversation_value',data:{
      key:'goal',revision:5,present:true,restored:false,value:{id:'00000000-0000-4000-8000-000000000005',description,state:'active',after:null},
    }}}},
    {command:{kind:'read_conversation_runs',data:{session,before:null,limit:100}},
      response:{Ok:{kind:'conversation_runs',data:history([run(recent,40,'completed')],recent)}}},
    {command:{kind:'read_conversation_runs',data:{session,before:recent,limit:100}},
      response:{Ok:{kind:'conversation_runs',data:history([run(stopped,2,'cancelled')],null)}}},
  ];
  const report=execute(input);
  assert.equal(report.result.Err,undefined);
  assert.equal(report.result.Ok.goal.state,'paused');
  assert.equal(report.result.Ok.goal.description,description);
  assert.equal(report.result.Ok.goal.revision,'5');
  assert.equal(report.calls.length,3);
  assert.equal(report.calls.some(call=>call.command.kind==='plugin_transaction'),false);
});
