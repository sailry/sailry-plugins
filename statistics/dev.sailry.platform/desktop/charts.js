// Date, category and tooltip policy adapted from Sailry ef5e82ea,
// plugins/builtin/statistics/desktop/workspace/charts{,/trend}.rs.
import {compact, integer, total} from './format.js';
export {compact};

const DAY = 86400000, HALF_HOUR = 1800000;
const pad = value => String(value).padStart(2, '0');
const localDay = date => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY;
const localDate = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const clock = date => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
const monthDay = date => `${date.getMonth() + 1}/${date.getDate()}`;
const timestamp = value => new Date(Number(value));
const valueOf = point => total(point.metrics.tokens) ?? (integer(point.metrics.responses) === 0n ? 0n : null);

export const SERIES = [{id:'cache', color:'chart_3', label:'usage_cache_hits'},
  {id:'input', color:'chart_2', label:'usage_uncached_input'}, {id:'output', color:'chart_4', label:'usage_column_output'}];

/** Disjoint token parts: cached input capped at input, uncached input and output. */
export function parts(tokens) {
  if (!tokens) return null;
  const input = integer(tokens.input), cached = integer(tokens.cached_input);
  const cache = cached < input ? cached : input;
  return [cache, input - cache, integer(tokens.output)];
}

export function heatmap(points, text) {
  const first = points.length ? timestamp(points[0].start_ms) : null;
  const start = first && Number.isFinite(first.getTime())
    ? localDay(first) - (first.getDay() + 6) % 7 : null;
  const days = [];
  for (const point of points) {
    const date = timestamp(point.start_ms);
    if (start === null || !Number.isFinite(date.getTime())) continue;
    const offset = localDay(date) - start;
    if (offset < 0) continue;
    const models = Object.entries(point.models).map(([name, tokens]) => [name, total(tokens)])
      .filter(([, value]) => value > 0n)
      .sort(([a, av], [b, bv]) => av !== bv ? (av > bv ? -1 : 1) : a < b ? -1 : a > b ? 1 : 0);
    if (models.length > 8) {
      const other = models.splice(8).reduce((sum, [, value]) => sum + value, 0n);
      models.push([text('usage_other_models'), other]);
    }
    days.push({date, offset, models, tokens:valueOf(point)});
  }
  const rows = days.length <= 31 ? 1 : 7;
  const columns = rows === 1 ? Math.max(days.length, 1) : Math.floor((days.at(-1)?.offset ?? 0) / 7) + 1;
  const maximum = days.reduce((maximum, day) => day.tokens > maximum ? day.tokens : maximum, 0n);
  const cells = days.map(day => {
    const level = day.tokens > 0n ? Math.ceil(Math.sqrt(Number(day.tokens) / Number(maximum)) * 4) : 0;
    const date = day.date;
    return {
      column:rows === 1 ? day.offset - days[0].offset : Math.floor(day.offset / 7),
      row:rows === 1 ? 0 : day.offset % 7,
      intensity:[0, 0.25, 0.45, 0.7, 1][Math.min(level, 4)],
      label:rows === 1 ? `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
        : text('usage_month').replace('%{month}', String(date.getMonth() + 1)),
      ...(rows === 1 ? {} : {label_group:`${date.getFullYear()}-${date.getMonth() + 1}`}),
      tooltip:{
        heading:localDate(date),
        title:`${compact(day.tokens) ?? text('composer_metric_unknown')} ${text('composer_tokens')}`,
        rows:day.models.map(([label, value]) => ({label, value:compact(value)})),
      },
    };
  });
  return {rows, columns, cells, active:days.filter(day => day.tokens > 0n).length};
}

/** Groups report points into half-hour, day or Monday-based week buckets in local time. */
export function buckets(points, unit) {
  const grouped = new Map();
  for (const point of points) {
    const date = timestamp(point.start_ms);
    if (!Number.isFinite(date.getTime())) continue;
    // Report days start at local midnight, so local calendar arithmetic keeps weeks aligned.
    const start = unit === 'week'
      ? new Date(date.getFullYear(), date.getMonth(), date.getDate() - (date.getDay() + 6) % 7).getTime()
      : date.getTime();
    let bucket = grouped.get(start);
    if (!bucket) {
      bucket = {start:new Date(start), first:date, last:date, values:[0n, 0n, 0n]};
      grouped.set(start, bucket);
    }
    if (date < bucket.first) bucket.first = date;
    if (date > bucket.last) bucket.last = date;
    const values = parts(point.metrics.tokens);
    if (values && bucket.values) values.forEach((value, index) => { bucket.values[index] += value; });
    else if (!values && integer(point.metrics.responses) > 0n) bucket.values = null;
  }
  return [...grouped.values()].sort((a, b) => a.start - b.start);
}

/** Rounded axis with at most four divisions and integer steps. */
export function axis(maximum) {
  const peak = Number(maximum);
  if (!(peak > 0)) return {maximum:0, ticks:[{value:0, label:'0'}, {value:1, label:'1'}]};
  const raw = peak / 4, power = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 2.5, 5, 10].map(factor => factor * power).find(value => value >= raw));
  const divisions = Math.max(1, Math.ceil(peak / step));
  const label = value => value < 1000 ? String(value) : compact(BigInt(Math.round(value))).replace('.0', '');
  return {maximum:step * divisions,
    ticks:Array.from({length:divisions + 1}, (_, index) => ({value:step * index, label:label(step * index)}))};
}

function heading(bucket, unit) {
  if (unit === 'half_hour') return `${localDate(bucket.start)} ${clock(bucket.start)}–${clock(new Date(bucket.start.getTime() + HALF_HOUR))}`;
  const first = localDate(bucket.first), last = localDate(bucket.last);
  return first === last ? first : `${first} – ${last}`;
}

// Sparse labels: three-hour marks, or about seven labels counted back from the newest bucket.
function labels(grouped, unit) {
  if (unit === 'half_hour') return grouped.map(({start}) => start.getMinutes() === 0 && start.getHours() % 3 === 0 ? clock(start) : '');
  const step = Math.max(1, Math.ceil(grouped.length / 7));
  return grouped.map(({start}, index) => (grouped.length - 1 - index) % step === 0 ? monthDay(start) : '');
}

export function trend(report, unit, text) {
  const grouped = buckets(unit === 'half_hour' ? report.recent ?? [] : report.days, unit);
  const sum = values => values.reduce((sum, value) => sum + value, 0n);
  const peak = grouped.reduce((maximum, bucket) => {
    const value = bucket.values ? sum(bucket.values) : 0n;
    return value > maximum ? value : maximum;
  }, 0n);
  const unknown = text('composer_metric_unknown'), names = labels(grouped, unit);
  return {
    series:SERIES.map(({id, color}) => ({id, color})),
    ...axis(peak),
    height:200,
    buckets:grouped.map((bucket, index) => ({
      label:names[index],
      values:bucket.values?.map(Number) ?? null,
      tooltip:{
        heading:heading(bucket, unit),
        rows:SERIES.map((series, part) => ({label:text(series.label), value:bucket.values ? compact(bucket.values[part]) : unknown})),
        footer:{label:text('composer_tokens'), value:bucket.values ? compact(sum(bucket.values)) : unknown},
      },
    })),
  };
}
