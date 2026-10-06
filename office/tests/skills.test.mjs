import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

test('skills use project environments without automatic installation', () => {
  for (const name of ['word', 'excel', 'powerpoint', 'pdf']) {
    const content = readFileSync(new URL(`../skills/${name}/SKILL.md`, import.meta.url), 'utf8');
    assert.match(content, /execution Node/);
    assert.match(content, /Sailry does not bundle Python or document libraries/);
    assert.match(content, /project-local virtual environment/);
    assert.match(content, /session's command permissions/);
    assert.match(content, /Loading this skill does not itself install anything/);
    assert.match(content, /Do not install globally or change the application's files/);
    assert.match(content, /read_office/);
    assert.match(content, /export_pdf/);
    assert.doesNotMatch(content, /get_office_runtime/);
  }
});
