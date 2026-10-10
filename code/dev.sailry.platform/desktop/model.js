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
