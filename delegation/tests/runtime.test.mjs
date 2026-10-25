import assert from 'node:assert/strict';
import {execute,packageInput,runtimeTest} from '../../scripts/test-host.mjs';

runtimeTest('production initializer applies only captured preferences',async()=>{
  for(const enabled of [false,true]) {
    for(const tools of [['spawn_agent'],['list_agents']]) {
      const input=await packageInput(new URL('../',import.meta.url),'initialize',{
        tools,roles:[],options:{proactive:enabled},
      },{policy:{call_id:'00000000-0000-4000-8000-000000000003',mode:'code',read_only:false,turn:{}}});
      const output=execute(input);
      assert.deepEqual(output.result.Ok.tools,tools);
      assert.doesNotMatch(output.result.Ok.instruction,/autonomous delegation|Proactive delegation/);
      assert.deepEqual(output.staged_turn,{roles:[],session_revision:null});
      assert.deepEqual(output.calls,[]);
    }
  }
});
