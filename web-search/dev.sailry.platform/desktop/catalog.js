// Public settings and model choices carry no authorization material.
export const drivers = ['exa','tinyfish','tavily','brave','searxng','bocha','volcengine','deepseek','model'];
const native = ['responses','anthropic','gemini'];

export function available(settings) {
  return (settings?.order ?? drivers).filter(driver => drivers.includes(driver) && Object.hasOwn(settings?.providers ?? {},driver));
}

export function needsKey(capability) {
  return capability?.key_required === true;
}

export function models(catalog) {
  return (catalog?.models ?? []).flatMap(item => {
    if(item.kind !== 'provider' || !native.includes(item.api) || item.authentication === 'copilot' || typeof item.id !== 'string')return [];
    const slash=item.id.indexOf('/');
    if(slash < 1 || slash === item.id.length-1)return [];
    return [{provider:item.id.slice(0,slash),provider_name:item.provider,model:item.id.slice(slash+1),default:item.default === true}];
  });
}

export function providers(choices) {
  return [...new Map(choices.map(item => [item.provider,{id:item.provider,label:item.provider_name}])).values()];
}

export function binding(choices,provider) {
  const choicesForProvider=choices.filter(item => item.provider === provider);
  const model=choicesForProvider.find(item => item.default) ?? choicesForProvider[0];
  return model ? {provider:model.provider,model:model.model} : null;
}

export function contains(choices,selected) {
  return !!selected && choices.some(item => item.provider === selected.provider && item.model === selected.model);
}
