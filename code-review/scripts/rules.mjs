import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';

const directory = new URL('../skills/code-review/rules/', import.meta.url);
const index = await readFile(new URL('index.md', directory), 'utf8');
const entries = [...index.matchAll(/^\| `([^`]+)` \| ([\w.]+) \|$/gm)]
  .map(([,pattern,rule]) => ({pattern,rule}));
const files = [...new Set([...entries.map(entry => entry.rule),'default.md','objc.md'])];
const rules = {}, bodies = {};
for (const file of files) {
  const body = await readFile(new URL(file,directory));
  rules[file] = {path:`rules/${file}`,sha256:createHash('sha256').update(body).digest('hex')};
  bodies[file] = body.toString('utf8');
}
const source = '// Generated from the ordered rule index; preserve the original rule resources.\n'
  + `export const entries = ${JSON.stringify(entries,null,2)};\n`
  + `export const rules = ${JSON.stringify(rules,null,2)};\n`;
const text = '// Generated from skills/code-review/rules. See the package NOTICE and LICENSE-APACHE.\n'
  + `export const bodies = ${JSON.stringify(bodies,null,2)};\n`;
for (const [name,content] of [['rules.js',source],['rule-text.js',text]]) {
  const output = new URL(`../dev.sailry.platform/host/${name}`,import.meta.url);
  if (process.argv.includes('--check')) {
    if (await readFile(output,'utf8') !== content) throw new Error(`Generated ${name} is stale`);
  } else await writeFile(output,content);
}
