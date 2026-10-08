export function selection(id) {
  const [tool, access = 'workspace'] = id.split(':');
  if (!tool || !['workspace', 'unrestricted'].includes(access) || id.split(':').length > 2)
    throw new Error('invalid terminal access');
  return {tool:tool === 'shell' ? null : tool, access};
}

export function choices(tools, text) {
  return [
    ...tools.map(entry => ({id:entry.tool,label:text.tools[entry.tool],enabled:entry.available})),
    {id:'shell:unrestricted',label:`${text.create} · ${text.full}`,enabled:true},
    ...tools.map(entry => ({id:`${entry.tool}:unrestricted`,
      label:`${text.tools[entry.tool]} · ${text.full}`,enabled:entry.available})),
  ];
}
