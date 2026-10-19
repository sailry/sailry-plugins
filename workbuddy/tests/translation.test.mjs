import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {cases,invalid} from './fixtures.mjs';
import {runtimeTest,translate,translationInput} from '../../scripts/test-host.mjs';

const root = new URL('../',import.meta.url);
const scripts = Object.fromEntries(['adapter','auth','credits'].map(name=>[name,{
  entry:`dev.sailry.platform/${name==='credits'?'desktop/credits':name}.js`,
  resources:[`dev.sailry.platform/${name==='credits'?'desktop/credits':name}.js`,
    ...(name==='auth'?[]:['dev.sailry.platform/errors.js'])],
}]));
const modules = {};
for (const [name,script] of Object.entries(scripts)) modules[name] = await import(new URL(script.entry,root));

for (const fixture of cases) {
  test(fixture.name,()=>{
    const result = modules[fixture.script??'adapter'][fixture.handler](structuredClone(fixture.input));
    fixture.check(JSON.parse(JSON.stringify(result)));
  });
  runtimeTest(`production VM ${fixture.name}`,async()=>{
    const report = translate(await translationInput(root,scripts[fixture.script??'adapter'],fixture.handler,fixture.input));
    assert.deepEqual(report.calls,[]);
    assert.equal(report.staged_turn,null);
    assert.ok(report.result.Ok);
    fixture.check(report.result.Ok);
  });
}
for (const fixture of invalid) {
  test(fixture.name,()=>assert.throws(()=>modules[fixture.script??'adapter'][fixture.handler](structuredClone(fixture.input))));
  runtimeTest(`production VM ${fixture.name}`,async()=>{
    const report = translate(await translationInput(root,scripts[fixture.script??'adapter'],fixture.handler,fixture.input));
    assert.deepEqual(report.calls,[]);
    assert.ok(report.result.Err);
    assert.equal(report.result.Err.message,'plugin translation failed');
    assert.ok(!JSON.stringify(report).includes('fixture-private-access'));
  });
}


test('groups regional presets without changing route identities',async()=>{
  const manifest=JSON.parse(await readFile(new URL('plugin.json',root),'utf8'));
  const presets=manifest.extensions['dev.sailry.platform'].model_providers;
  assert.equal(manifest.version,'0.1.5');
  assert.deepEqual(presets.map(preset=>preset.id),['china','workbuddy-global','codebuddy-global']);
  assert.equal(new Set(presets.map(preset=>preset.name)).size,3);
  for (const preset of presets) {
    assert.equal(preset.brand,'workbuddy');
    assert.deepEqual(preset.brand_display,{label:'WorkBuddy',locales:{'zh-CN':'WorkBuddy','zh-TW':'WorkBuddy'},icon:'reicon:messages/chat'});
    assert.equal(preset.routes[0].protocol,'plugin');
    assert.equal(preset.auth.data.flow,preset.id);
  }
});

test('declares regional protected reads without shared model origins',async()=>{
  const manifest=JSON.parse(await readFile(new URL('plugin.json',root),'utf8'));
  const extension=manifest.extensions['dev.sailry.platform'];
  assert.ok(extension.actions.includes('http.request'));
  assert.deepEqual(extension.model_auth.map(flow=>flow.requests.credits.url),[
    'https://www.codebuddy.cn/v2/billing/meter/get-user-resource',
    'https://www.workbuddy.ai/v2/billing/meter/get-user-resource',
    'https://www.codebuddy.ai/v2/billing/meter/get-user-resource',
  ]);
  for(const flow of extension.model_auth){
    const request=flow.requests.credits;
    assert.equal(request.method,'POST');
    assert.deepEqual(request.body.value,{PageNumber:1,PageSize:100,ProductCode:'p_tcaca',Status:[0,3],
      PackageEndTimeRangeBegin:'{input.begin}',PackageEndTimeRangeEnd:'{input.end}'});
    assert.ok(Object.values(request.headers).every(value=>!value.includes('{')));
  }
  assert.deepEqual(extension.ui.map(entry=>[entry.id,entry.slot,entry.kind]),[['credits','footer','metric']]);
  assert.equal(extension.model_adapters[0].origins.includes('https://www.codebuddy.cn'),false);
});
