// Preserve the Node-wide catalog and installed-package union from Sailry d8776c2a.
export function rows(catalog, installations) {
  const result = new Map();
  for (const language of catalog) for (const candidate of language.servers) {
    let row = result.get(candidate.server);
    if (!row) {
      row = {server:candidate.server,languages:[],candidate,
        installation:installations.find(item => item.package === candidate.package?.name)};
      result.set(candidate.server,row);
    }
    const label = language.name;
    if (!row.languages.includes(label)) row.languages.push(label);
  }
  for (const installation of installations) {
    if (![...result.values()].some(row => row.installation?.package === installation.package))
      result.set(installation.package,{server:installation.package,languages:[],installation});
  }
  return [...result.values()].sort((left,right) => left.server.localeCompare(right.server));
}
export function installed(row) {
  return !!row.installation?.receipt || (!!row.candidate && row.candidate.status !== 'not_installed');
}
export function installing(row) {
  return ['preparing','downloading','installing'].includes(row.installation?.status);
}
export function available(row) {
  return !installed(row) && (!!row.candidate?.package?.install || installing(row));
}
export function failure(code, message = '', kind = '') {
  if (code === 'cancelled') return 'code_cancelled';
  if (code === 'revision_conflict') return 'code_conflict';
  if (code === 'permission_denied') return 'code_denied';
  if (code === 'outcome_unknown') return 'code_unknown';
  if (code !== 'invalid_request') return 'code_failed';
  if (message === 'language package is not in the current registry') return 'code_registry_missing';
  if (message === 'language source requires unsupported build or version rules')
    return 'code_rules_unsupported';
  if (/^language package(?: asset)? is unavailable on this platform$|^language package has no asset for this platform$/.test(message))
    return 'code_package_unavailable';
  if (/ is not available in the Node login environment$/.test(message)) return 'code_toolchain_unavailable';
  if (['language source is not supported','language package source is not supported by this installer',
    'language package has no supported package URL','language package URL needs unsupported qualifiers',
    'invalid GitHub package source','language toolchain source requires unsupported assets',
    'extra packages are supported only for npm sources'].includes(message)
      || /requires unsupported installation rules|requires an unsupported launcher|uses an unsupported template|rename is not supported|archive format is not supported/.test(message))
    return 'code_source_unsupported';
  if (kind === 'update_code_rules' || kind === 'read_code_rules'
      || /^(?:Helix |Mason |cached language |language (?:rules|snapshot|update) )/.test(message))
    return 'code_rules_failed';
  return kind === 'install_code_server' ? 'code_package_invalid' : 'code_invalid';
}
export function override(values, previous) {
  const [command,args,config,environment] = values.map(value => value.trim());
  const result = {disabled:previous?.disabled ?? false,command:command || null,
    args:args ? JSON.parse(args) : null,config:config ? JSON.parse(config) : null,
    environment:environment ? JSON.parse(environment) : null};
  if (result.args !== null && (!Array.isArray(result.args) || result.args.some(value => typeof value !== 'string')))
    throw new Error('invalid arguments');
  if (result.environment !== null && (typeof result.environment !== 'object' || Array.isArray(result.environment)
      || Object.values(result.environment).some(value => typeof value !== 'string')))
    throw new Error('invalid environment');
  return result;
}
