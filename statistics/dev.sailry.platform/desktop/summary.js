// Overview figures derived from exact report totals.
import {integer, ratio, amount, speed} from './format.js';
import {parts} from './charts.js';

export function tokenCoverage(metrics) {
  const responses = integer(metrics?.responses ?? '0');
  const tokens = metrics?.tokens ?? metrics?.token_subtotal ?? null;
  const reported = tokens == null ? 0n : responses - integer(metrics.incomplete_token_responses ?? '0');
  return {tokens, responses, reported};
}

/** Token composition, cache hit rate, speed and estimated cost for one report. */
export function overview(totals) {
  const {tokens, responses, reported} = tokenCoverage(totals), values = parts(tokens);
  const sum = values ? values.reduce((sum, value) => sum + value, 0n) : null;
  const priced = totals?.cost ? integer(totals.cost.responses) : 0n;
  return {
    total:sum,
    parts:values,
    shares:values ? values.map(value => ratio(value, sum)) : null,
    reasoning:tokens ? integer(tokens.reasoning) : null,
    hit:tokens && reported === responses ? ratio(values[0], integer(tokens.input)) : null,
    responses,
    reported,
    speed:speed(totals?.generation),
    cost:totals?.cost ? amount(totals.cost.usd_micros) : null,
    priced,
    partial:!!totals?.cost && priced < responses,
  };
}

/** One decimal percentage label, or null for an unknown share. */
export const percent = value => value == null ? null : `${value.toFixed(1)}%`;
