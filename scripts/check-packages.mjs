/** Validate committed package assets without linking or executing plugin code. */
import {execFileSync} from 'node:child_process';
import {readFileSync, realpathSync, statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SourceTextModule} from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const number = '(?:0|[1-9]\\d*)';
const preview = '(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)';
const version = new RegExp(`^${number}\\.${number}\\.${number}(?:-${preview}(?:\\.${preview})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`);
const modules = new Set([
  'gpui-base', 'gpui-component', 'gpui-kit', 'sailry', 'sailry/ui',
  'sailry/forms', 'sailry/sdk', 'sailry/connections', 'sailry/credentials',
  'sailry/documents', 'sailry/file-transfers', 'sailry/ssh-transfers',
]);

export function dependencies(source, identifier) {
  // Construction parses syntax; do not link, instantiate or evaluate modules.
  return new SourceTextModule(source, {identifier}).moduleRequests.map(request => request.specifier);
}

function distinct(values, label) {
  if (!Array.isArray(values) || values.some(value => typeof value !== 'string' || !value)
      || new Set(values).size !== values.length) {
    throw new Error(`${label} must contain distinct nonempty strings`);
  }
}

export function resource(directory, value) {
  if (typeof value !== 'string' || !value || /[\\:]/.test(value)
      || value.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Invalid package resource: ${value}`);
  }
  const target = path.resolve(directory, value), relative = path.relative(directory, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !statSync(target).isFile()) {
    throw new Error(`Resource must be a file inside the package: ${value}`);
  }
  const actual = path.relative(realpathSync(directory), realpathSync(target));
  if (actual === '..' || actual.startsWith(`..${path.sep}`) || path.isAbsolute(actual)) {
    throw new Error(`Resource escapes the package: ${value}`);
  }
  return target;
}

export function checkPackage(manifest) {
  const directory = path.dirname(manifest), data = JSON.parse(readFileSync(manifest, 'utf8'));
  if (data.name !== path.basename(directory) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.name)) {
    throw new Error('Package name must match its directory');
  }
  if (typeof data.version !== 'string' || !version.test(data.version)) {
    throw new Error('Package version must be a semantic version');
  }
  const extension = data.extensions?.['dev.sailry.platform'];
  if (!extension || extension.api_version !== 'v1') throw new Error('Sailry extension must use v1');
  distinct(extension.actions ?? [], 'Actions');
  const sections = [extension.host, extension.desktop, extension.settings_page].filter(Boolean);
  for (const section of sections) distinct(section.resources ?? [], 'Resources');
  distinct(extension.host?.handlers ?? [], 'Host handlers');
  if (extension.tools) distinct(extension.tools.map(tool => tool.name), 'Tools');
  const declared = new Set(sections.flatMap(section => [
    ...(section.resources ?? []), ...['entry', 'ui_entry'].flatMap(key => section[key] ? [section[key]] : []),
  ]));
  const files = new Set([...declared].map(value => resource(directory, value)));
  for (const filename of files) {
    if (!filename.endsWith('.js') && !filename.endsWith('.mjs')) continue;
    for (const specifier of dependencies(readFileSync(filename, 'utf8'), filename)) {
      if (!specifier.startsWith('.')) {
        if (!modules.has(specifier)) throw new Error(`Unsupported host module: ${specifier}`);
        continue;
      }
      const value = path.relative(directory, path.resolve(path.dirname(filename), specifier)).split(path.sep).join('/');
      const imported = resource(directory, value);
      if (!files.has(imported)) throw new Error(`Import is not a declared package resource: ${value}`);
    }
  }
  return files.size;
}

function main() {
  const files = execFileSync('git', ['ls-files', '-z'], {cwd: root, encoding: 'utf8'}).split('\0').filter(Boolean);
  let packages = 0, resources = 0, sources = 0;
  for (const file of files) {
    const filename = path.join(root, file);
    try {
      if (file.endsWith('.json')) JSON.parse(readFileSync(filename, 'utf8'));
      if (file.endsWith('.js') || file.endsWith('.mjs')) {
        dependencies(readFileSync(filename, 'utf8'), filename);
        ++sources;
      }
      if (path.basename(file) === 'plugin.json') {
        resources += checkPackage(filename);
        ++packages;
      }
    } catch (error) {
      throw new Error(`${file}: ${error.message}`);
    }
  }
  if (!packages || !sources) throw new Error('No plugin packages or JavaScript sources found');
  console.log(`Checked ${packages} packages, ${resources} resources and ${sources} JavaScript sources`);
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
