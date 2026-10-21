import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const document = async name => JSON.parse(await readFile(new URL(`../${name}`,import.meta.url),'utf8'));

test('declares metadata without replacing backend tool authority', async () => {
  const manifest = await document('plugin.json');
  const extension = manifest.extensions['dev.sailry.platform'];
  assert.deepEqual(extension.actions,['computer.read','computer.control']);
  assert.equal(extension.scope,'host');
  assert.deepEqual(extension.tools.map(tool => tool.name).sort(),[
    'click','drag','get_app_state','list_apps','perform_secondary_action',
    'press_key','query','scroll','set_value','type_text'
  ]);
  for (const tool of extension.tools) {
    assert.equal(tool.server,'desktop');
    assert.deepEqual(Object.keys(tool).sort(),['display','name','server']);
  }
  const mcp = await document('mcp.json');
  assert.equal(mcp.$schema,'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json');
  assert.deepEqual(Object.keys(mcp.mcpServers),['desktop']);
  const server = mcp.mcpServers.desktop;
  assert.equal(server.type,'stdio');
  assert.equal(server.command,'${SAILRY_COMPUTER_USE}');
  assert.deepEqual(server.args,['mcp']);
  assert.deepEqual(server.env,{
    OPEN_COMPUTER_USE_AGENT_SOCKET_NAMESPACE:'${PLUGIN_DATA}',
    OPEN_COMPUTER_USE_CONFIG_FILE:'${PLUGIN_ROOT}/ocu.json'
  });
  assert.equal(server.exclusive,true);
  assert.equal(server.keep_images,3);
  assert.equal(server.reuse,false);
  assert.equal((await document('ocu.json')).image.maxLongEdgePixels,1280);
});
