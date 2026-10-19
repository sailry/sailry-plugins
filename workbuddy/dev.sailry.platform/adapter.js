// SPDX-License-Identifier: MIT
// Wire rules adapted from the fixed third-party references recorded in NOTICE.
const endpoints = {
  'https://copilot.tencent.com': 'https://www.codebuddy.cn',
  'https://www.workbuddy.ai': 'https://www.workbuddy.ai',
  'https://www.codebuddy.ai': 'https://www.codebuddy.ai',
};
const client = 'CLI/2.63.2 CodeBuddy/2.63.2';

function base(endpoint) {
  const value = endpoint.replace(/\/+$/, '');
  if (!Object.hasOwn(endpoints, value)) throw new Error('Unsupported WorkBuddy endpoint');
  return value;
}

// Correlation identifiers are not authentication or durable command identities.
function identifier() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    const value = Math.floor(Math.random() * 16);
    return (char === 'x' ? value : (value & 3) | 8).toString(16);
  });
}

function parts(values) {
  return values.map(part => {
    if (part.kind === 'text') return {type: 'text', text: part.text};
    if (part.kind === 'image') {
      const data = part.data;
      const url = data.kind === 'inline' ? `data:${part.media_type};base64,${data.data_base64}` : data.url;
      return {type: 'image_url', image_url: {url}};
    }
    throw new Error('Unsupported WorkBuddy message part');
  });
}

function message(value) {
  if (value.role === 'user') return {role: 'user', content: parts(value.parts)};
  if (value.role === 'tool') {
    const content = value.parts.map(part => {
      if (part.kind === 'text') return part.text;
      if (part.kind === 'json') return JSON.stringify(part.value);
      throw new Error('Unsupported WorkBuddy tool result');
    }).join('\n');
    return {role: 'tool', tool_call_id: value.call_id, content};
  }
  if (value.role !== 'assistant') throw new Error('Unsupported WorkBuddy message role');
  const result = {role: 'assistant', content: ''};
  const calls = [];
  let reasoning = '';
  for (const part of value.parts) {
    if (part.kind === 'text') result.content += part.text;
    else if (part.kind === 'reasoning') reasoning += part.replay ?? part.text ?? '';
    else if (part.kind === 'tool_call') calls.push({id: part.id, type: 'function',
      function: {name: part.name, arguments: JSON.stringify(part.arguments)}});
    else throw new Error('Unsupported WorkBuddy assistant part');
  }
  if (calls.length) result.tool_calls = calls;
  if (reasoning) result.reasoning_content = reasoning;
  return result;
}

export function prepare(input) {
  if (input.version !== 'v1') throw new Error('Unsupported model translation version');
  const endpoint = base(input.endpoint);
  const messages = [{role: 'system', content: input.system || 'You are a helpful assistant.'},
    ...input.messages.map(message)];
  const body = {model: input.model, messages, stream: true};
  const choice = input.tool_choice;
  if (choice.kind !== 'none' && input.tools.length) {
    body.tools = input.tools.map(tool => ({type: 'function', function: {
      name: tool.name, description: tool.description ?? '', parameters: tool.parameters}}));
    body.tool_choice = choice.kind === 'named' ? choice.name : choice.kind;
  }
  if (input.max_output_tokens != null) body.max_tokens = input.max_output_tokens;
  if (input.temperature != null) body.temperature = input.temperature;
  if (input.top_p != null) body.top_p = input.top_p;
  if (input.stop?.length) body.stop = input.stop;
  const effort = input.reasoning?.effort;
  if (effort && effort !== 'default' && effort !== 'none') {
    if (typeof effort !== 'string') throw new Error('WorkBuddy requires a declared effort level');
    body.reasoning_effort = effort;
  }
  return {method: 'POST', url: `${endpoint}/v2/chat/completions`, headers: {
    'Content-Type': 'application/json', 'User-Agent': client,
    Origin: endpoints[endpoint], Referer: `${endpoints[endpoint]}/`,
    'X-Requested-With': 'XMLHttpRequest', 'X-Product': 'SaaS',
    'X-No-User-Id': '1', 'X-No-Enterprise-Id': '1',
    'X-Conversation-ID': identifier(), 'X-Conversation-Request-ID': identifier(),
    'X-Conversation-Message-ID': identifier(),
  }, body: JSON.stringify(body), credential: {header: 'Authorization', template: 'Bearer {access}'}, framing: 'sse'};
}

function count(value) {
  if (value == null) return undefined;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid WorkBuddy usage count');
  return value;
}

export function decode(input) {
  const state = {...input.state ?? {finished: false}};
  const deltas = [];
  for (const event of input.events) {
    if (event.data === '[DONE]') {
      if (!state.finished) deltas.push({kind: 'finish', reason: 'stop'});
      state.finished = true;
      continue;
    }
    const chunk = JSON.parse(event.data);
    if (chunk.error) {
      deltas.push({kind: 'error', ...classify({status: input.status ?? 200, body: event.data})});
      state.finished = true;
      continue;
    }
    if (chunk.usage) {
      const usage = chunk.usage;
      deltas.push({kind: 'usage', input_tokens: count(usage.prompt_tokens),
        output_tokens: count(usage.completion_tokens),
        cached_input_tokens: count(usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens),
        reasoning_tokens: count(usage.completion_tokens_details?.reasoning_tokens)});
    }
    const choice = chunk.choices?.[0];
    if (!choice) continue;
    const delta = choice.delta ?? {};
    if (typeof delta.content === 'string' && delta.content) deltas.push({kind: 'text', text: delta.content});
    if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
      deltas.push({kind: 'reasoning', text: delta.reasoning_content, replay: delta.reasoning_content});
    }
    for (const call of delta.tool_calls ?? []) {
      if (!Number.isSafeInteger(call.index) || call.index < 0) throw new Error('Invalid WorkBuddy tool index');
      deltas.push({kind: 'tool_call', index: call.index, id: call.id,
        name: call.function?.name, arguments_delta: call.function?.arguments});
    }
    if (choice.finish_reason != null) {
      const reasons = {stop: 'stop', length: 'length', tool_calls: 'tool_calls', content_filter: 'content_filter'};
      deltas.push({kind: 'finish', reason: reasons[choice.finish_reason] ?? 'other'});
      state.finished = true;
    }
  }
  if (input.done && !state.finished) throw new Error('WorkBuddy response ended without a completion');
  return {state, deltas};
}

export function classify(input) {
  let value;
  try { value = JSON.parse(input.body); } catch { value = {}; }
  const error = value.error ?? value;
  const code = String(error.code ?? '');
  let kind = 'unknown';
  if (input.status === 401) kind = 'authentication';
  else if (input.status === 403 || code === '11140') kind = 'permission';
  else if (input.status === 402 || code === '14018') kind = 'quota';
  else if (input.status === 413 || code === '11115') kind = 'context_overflow';
  else if (input.status === 429) kind = 'rate_limited';
  else if (input.status >= 500) kind = 'unavailable';
  else if (input.status >= 400) kind = 'invalid_request';
  const message = [error.displayTips, error.message, error.msg].find(value => typeof value === 'string' && value);
  return {class: kind, message: message ?? 'WorkBuddy request failed'};
}

export function prepare_discovery(input) {
  const endpoint = base(input.endpoint);
  return {method: 'GET', url: `${endpoint}/v3/config`, headers: {
    Accept: 'application/json', 'User-Agent': endpoint === 'https://copilot.tencent.com' ? client : 'WorkBuddy/5.5.2',
    Origin: endpoints[endpoint], Referer: `${endpoints[endpoint]}/`,
    'X-Requested-With': 'XMLHttpRequest', 'X-Product': 'SaaS',
  }, body: null, credential: {header: 'Authorization', template: 'Bearer {access}'}, framing: 'json'};
}

export function decode_discovery(input) {
  if (input.status < 200 || input.status >= 300) throw new Error('WorkBuddy model discovery failed');
  const document = typeof input.body === 'string' ? JSON.parse(input.body) : input.body;
  if (!document || typeof document !== 'object') throw new Error('Invalid WorkBuddy model catalog');
  if (Object.hasOwn(document, 'code') && document.code !== 0 && document.code !== 200) {
    throw new Error('WorkBuddy model catalog was refused');
  }
  const data = document.data ?? document;
  if (!data || !Array.isArray(data.models)) throw new Error('Invalid WorkBuddy model catalog');
  const models = new Map();
  for (const model of data.models) {
    if (model.disabled === true || typeof model.id !== 'string' || !model.id
      || !Number.isSafeInteger(model.maxInputTokens) || model.maxInputTokens <= 0
      || !Number.isSafeInteger(model.maxOutputTokens) || model.maxOutputTokens <= 0) continue;
    const reasoning = model.reasoning;
    const efforts = Array.isArray(reasoning?.supportedEfforts) ? reasoning.supportedEfforts : undefined;
    const capabilities = {};
    if (typeof model.supportsToolCall === 'boolean') capabilities.tools = model.supportsToolCall;
    if (typeof model.supportsImages === 'boolean') capabilities.vision = model.disabledMultimodal !== true && model.supportsImages;
    if (efforts?.length) {
      const known = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
      capabilities.efforts = efforts.filter(value => known.includes(value));
      capabilities.reasoning = capabilities.efforts.length > 0;
      if (capabilities.efforts.includes(reasoning.defaultEffort)) capabilities.default_effort = reasoning.defaultEffort;
    }
    models.set(model.id, {id: model.id, display_name: model.name || model.id,
      context: model.maxInputTokens, output: model.maxOutputTokens, capabilities});
  }
  const roster = data.agents?.find(agent => agent.name === 'cli')?.models;
  const selected = Array.isArray(roster) && roster.length ? roster.map(id => models.get(id)).filter(Boolean) : [...models.values()];
  if (!selected.length) throw new Error('WorkBuddy model catalog is empty');
  return {endpoint: input.endpoint, models: selected};
}
