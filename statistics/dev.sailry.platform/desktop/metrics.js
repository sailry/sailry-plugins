import {compact,total,integer,cost,cache,speed,duration,context,severity} from './format.js';

function sum(left,right) {
  return left == null && right == null ? null : integer(left ?? 0n) + integer(right ?? 0n);
}

export function metrics(state,text) {
  const statistics = state.statistics, usage = statistics?.usage, generation = statistics?.generation;
  const delegated = statistics?.delegated;
  const number = value => compact(value) ?? '0';
  const charge = value => '$'+(value ?? '0.00');
  const row = (key,value) => ({label:{label:text[key]},value:value ?? '0'});
  const input = usage ? integer(usage.input) : null, cached = usage ? integer(usage.cached_input) : null;
  const uncached = input == null ? null : input > cached ? input-cached : 0n;
  const ownTokens = total(usage), childTokens = total(delegated?.tokens);
  const micros = sum(statistics?.cost?.usd_micros,delegated?.cost?.usd_micros);
  const combined = cost({responses:sum(statistics?.responses,delegated?.responses),
    cost:micros == null ? null : {usd_micros:micros,
      responses:sum(statistics?.cost?.responses,delegated?.cost?.responses)}});
  const rate = speed(generation);
  const values = [
    ['composer_tokens',number(sum(ownTokens,childTokens)),[
      row('composer_this_session',number(ownTokens)),
      row('composer_subagents',number(childTokens))]],
    ['composer_speed',rate == null ? null : rate+'/s',[
      row('composer_timed_responses',number(generation?.responses)),row('composer_timed_output',number(generation?.output_tokens)),
      row('composer_first_token',statistics?.first_token_us == null ? '0' : duration(statistics.first_token_us,text))]],
    ['composer_cost',combined ?? '0.00',[
      row('composer_this_session',charge(cost(statistics))),
      row('composer_subagents',charge(cost(delegated)))]],
    ['composer_cache',cache(usage),[
      row('composer_cached_input',number(cached)),row('composer_uncached_input',number(uncached)),row('composer_input_tokens',number(input))]],
    ['composer_turns',number(statistics?.turns),[row('composer_responses',number(statistics?.responses))]],
  ];
  const limit = statistics?.context_limit;
  const estimated = statistics?.context_tokens == null && statistics?.context_estimate != null;
  const tokens = statistics?.context_tokens ?? statistics?.context_estimate;
  const percent = context(tokens,limit);
  const hint = state.compacting ? text.chat_compacting : percent == null ? text.composer_context_unknown
    : (estimated ? text.composer_context_estimate : text.composer_context_usage)
      .replace('%{used}',number(tokens)).replace('%{limit}',number(limit));
  return [...values.map(([id,value,details])=>({id,value:value ?? '0',visible:state.has_messages,details})),
    {id:'context',value:{percent,loading:state.compacting,tone:severity(percent),hint},visible:!state.sidebar}];
}
