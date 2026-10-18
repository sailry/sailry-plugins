import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {cases,invalid} from './fixtures.mjs';
import {runtimeTest,translate,translationInput} from '../../scripts/test-host.mjs';

const root = new URL('../',import.meta.url);
const scripts = Object.fromEntries(['adapter','auth'].map(name=>[name,{
  entry:`dev.sailry.platform/${name}.js`,resources:[`dev.sailry.platform/${name}.js`],
}]));
const modules = {};
for (const [name,script] of Object.entries(scripts)) {
  const source = await readFile(new URL(script.entry,root),'utf8');
  modules[name] = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

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
