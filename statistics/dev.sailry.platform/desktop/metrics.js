import {compact,grouped,total,integer,cost,cache,speed,duration} from './format.js';

function sum(left,right) {
  return left == null && right == null ? null : integer(left ?? 0n) + integer(right ?? 0n);
}

// Composer statistics carry token subtotals as reported, unlike usage reports'
// token_subtotal projection: they cover only responses reporting both counts.
// A nonzero incomplete_token_responses, or absent tokens beside recorded
// responses on hosts predating that field, leaves responses unreported.
function tokens(value,responses,incomplete) {
  const count = integer(responses ?? 0n), missing = integer(incomplete ?? 0n);
  const reported = value == null ? 0n : count > missing ? count-missing : 0n;
  return {total:total(value),responses:count,reported,partial:reported < count};
}

function generationSpeed(attempt) {
  const first = integer(attempt?.first_token_us), elapsed = integer(attempt?.elapsed_us);
  const output = integer(attempt?.usage?.output);
  if (first == null || elapsed == null || elapsed <= first || output == null) return null;
  const hiddenReasoning = attempt.reasoning_streamed ? 0n : integer(attempt.usage.reasoning ?? 0n);
  return speed({output_tokens:output > hiddenReasoning ? output-hiddenReasoning : 0n,elapsed_us:elapsed-first});
}

export function metrics(state,text) {
  const statistics = state.statistics, usage = statistics?.usage, throughput = statistics?.throughput;
  const observations = statistics?.observations;
  const latest = observations?.recent?.at(-1)?.attempts?.at(-1);
  const delegated = statistics?.delegated;
  // Message pages may still be loading; persisted statistics cover the whole session.
  const recorded = state.has_messages || [statistics?.turns,statistics?.responses,delegated?.responses,
    usage?.input,usage?.output,delegated?.tokens?.input,delegated?.tokens?.output]
    .some(value=>value!=null && integer(value)>0n);
  const number = value => compact(value) ?? text.composer_metric_unknown;
  // Matches the usage page's labels for a subtotal and its coverage.
  const subtotal = (value,partial) => value == null ? null : partial
    ? text.usage_token_subtotal.replace('%{value}',compact(value)) : compact(value);
  const coverage = (reported,responses) => ({label:{label:text.usage_token_coverage
    .replace('%{reported}',grouped(reported)).replace('%{responses}',grouped(responses))},value:''});
  const charge = value => value==null ? text.composer_metric_unknown : '$'+value;
  const row = (key,value) => ({label:{label:text[key]},value:value ?? text.composer_metric_unknown});
  const own = tokens(usage,statistics?.responses,statistics?.incomplete_token_responses);
  const child = tokens(delegated?.tokens,delegated?.responses,delegated?.incomplete_token_responses);
  const input = usage ? integer(usage.input) : null, cached = usage ? integer(usage.cached_input) : null;
  const uncached = input == null ? null : input > cached ? input-cached : 0n;
  const micros = sum(statistics?.cost?.usd_micros,delegated?.cost?.usd_micros);
  const combined = cost({responses:sum(statistics?.responses,delegated?.responses),
    cost:micros == null ? null : {usd_micros:micros,
      responses:sum(statistics?.cost?.responses,delegated?.cost?.responses)}});
  const formatRate = value => value == null ? text.composer_metric_unknown : `${value} ${text.usage_speed_unit}`;
  const partial = own.partial || child.partial;
  const tokenDetails = [row('composer_this_session',subtotal(own.total,own.partial)),
    row('composer_subagents',subtotal(child.total,child.partial)),
    ...partial ? [coverage(own.reported+child.reported,own.responses+child.responses)] : []];
  const values = [
    ['composer_tokens',subtotal(sum(own.total,child.total),partial),tokenDetails],
    ['composer_speed',formatRate(speed(throughput)),[
      row('composer_average_ttft',duration(observations?.latency?.first_token_us,text)),
      row('composer_latest_tps',formatRate(generationSpeed(latest))),
      row('composer_latest_ttft',duration(latest?.first_token_us,text))]],
    ['composer_cost',combined,[
      row('composer_this_session',charge(cost(statistics))),
      row('composer_subagents',charge(cost(delegated)))]],
    // Like the usage page's hit rate, a ratio over a token subtotal is not reported.
    ['composer_cache',own.partial && usage ? text.composer_metric_unknown : cache(usage),[
      row('composer_cached_input',number(cached)),row('composer_uncached_input',number(uncached)),row('composer_input_tokens',number(input)),
      ...own.partial ? [coverage(own.reported,own.responses)] : []]],
    ['composer_turns',recorded ? compact(statistics?.turns) : null,[row('composer_responses',number(statistics?.responses))]],
  ];
  return [...values.map(([id,value,details])=>({id,value:value ?? text.composer_metric_unknown,visible:recorded && value != null,details}))];
}
