import test from 'node:test';
import assert from 'node:assert/strict';
import {heatmap, trend, buckets, axis, parts} from '../dev.sailry.platform/desktop/charts.js';

const labels = {usage_other_models:'Other models',usage_month:'Month %{month}',composer_metric_unknown:'Unknown',composer_tokens:'Token',usage_cache_hits:'Cache hits',usage_uncached_input:'Uncached input',usage_column_output:'Output'};
const text = key => labels[key] ?? key;
const usage = (input = '12', output = '3', cached_input = '4') => ({input,output,cached_input,reasoning:'2'});
const DAY = 86400000, HALF_HOUR = 1800000;
// Report points start at local boundaries; tests build them from local calendar dates.
function point(start, tokens = usage(), responses = tokens ? '1' : '0') {
  return {start_ms:String(start),metrics:{responses,tokens},models:{}};
}
const local = (year, month, day, hour = 0, minute = 0) => new Date(year, month - 1, day, hour, minute).getTime();
const days = (from, count, tokens = () => usage()) => Array.from({length:count}, (_, index) => {
  const date = new Date(from);
  return point(new Date(date.getFullYear(), date.getMonth(), date.getDate() + index).getTime(), tokens(index));
});
const footers = chart => chart.buckets.map(bucket => bucket.tooltip.footer.value);
function zone(name, body) {
  const prior = process.env.TZ;
  try { process.env.TZ = name; body(); }
  finally { if (prior === undefined) delete process.env.TZ; else process.env.TZ = prior; }
}

test('caps cached input at input without counting reasoning twice', () => {
  assert.deepEqual(parts(usage('2','3','7')), [2n,0n,3n]);
  assert.deepEqual(parts(usage('12','3','4')), [4n,8n,3n]);
  assert.equal(parts(null), null);
  const chart = trend({days:[point(local(2024,1,1))]}, 'day', text);
  assert.deepEqual(chart.buckets[0].values, [4,8,3]);
  assert.deepEqual(chart.series, [{id:'cache',color:'chart_3'},{id:'input',color:'chart_2'},{id:'output',color:'chart_4'}]);
  assert.deepEqual(chart.buckets[0].tooltip.rows.map(row => row.label), ['Cache hits','Uncached input','Output']);
  assert.equal(chart.height, 200);
  const large = trend({days:[point(local(2024,1,1), usage('18446744073709551615','18446744073709551615','18446744073709551615'))]}, 'day', text);
  assert.equal(large.buckets[0].tooltip.footer.value, '36893488.1T');
  assert.doesNotThrow(() => JSON.stringify(large));
});

test('range units select half-hour, day and week buckets', () => {
  zone('Asia/Shanghai', () => {
    const recent = Array.from({length:48}, (_, index) => point(local(2026,10,13,10,30) + index * HALF_HOUR, index === 1 ? usage() : null));
    const report = {recent, days:days(local(2026,9,1), 44)};
    const hours = trend(report, 'half_hour', text);
    assert.equal(hours.buckets.length, 48);
    assert.equal(hours.buckets[1].tooltip.heading, '2026-10-13 11:00–11:30');
    assert.deepEqual(hours.buckets.filter(bucket => bucket.label).map(bucket => bucket.label).slice(0,3), ['12:00','15:00','18:00']);
    const daily = trend(report, 'day', text);
    assert.equal(daily.buckets.length, 44);
    assert.equal(daily.buckets[0].tooltip.heading, '2026-09-01');
    assert.equal(daily.buckets.at(-1).label, '10/14');
    assert.ok(daily.buckets.filter(bucket => bucket.label).length <= 8);
    const weekly = trend(report, 'week', text);
    // 2026-09-01 is a Tuesday; the first week is partial and starts at Monday 08-31.
    assert.equal(weekly.buckets.length, 7);
    assert.equal(weekly.buckets[0].tooltip.heading, '2026-09-01 – 2026-09-06');
    assert.equal(weekly.buckets[1].tooltip.heading, '2026-09-07 – 2026-09-13');
    assert.equal(weekly.buckets.at(-1).label, '10/12');
  });
});

test('groups local Monday weeks over year and leap boundaries', () => {
  for (const name of ['UTC', 'America/New_York', 'Asia/Kolkata']) zone(name, () => {
    for (const start of [local(2023,12,31), local(2024,2,25)]) {
      const points = days(start, 9, index => index === 3 ? null : usage());
      const grouped = buckets(points, 'week');
      assert.deepEqual(grouped.map(bucket => bucket.values.reduce((sum, value) => sum + value, 0n)), [15n, 90n, 15n]);
      assert.deepEqual(grouped.map(bucket => bucket.start.getDay()), [1, 1, 1]);
      const daily = buckets(points, 'day');
      assert.equal(daily.length, 9);
      assert.deepEqual(daily[3].values, [0n,0n,0n]);
    }
  });
});

test('keeps empty and unknown distinct and poisons incomplete weeks', () => {
  const points = [point(local(2024,1,1), null), point(local(2024,1,2)), point(local(2024,1,3), null, '1')];
  const daily = trend({days:points}, 'day', text), weekly = trend({days:points}, 'week', text);
  assert.deepEqual(footers(daily), ['0','15','Unknown']);
  assert.deepEqual(daily.buckets[0].values, [0,0,0]);
  assert.equal(daily.buckets[2].values, null);
  assert.deepEqual(footers(weekly), ['Unknown']);
  assert.equal(weekly.buckets[0].values, null);
  const empty = trend({days:[], recent:[]}, 'half_hour', text);
  assert.deepEqual(empty.buckets, []);
  assert.deepEqual(empty.ticks, [{value:0,label:'0'},{value:1,label:'1'}]);
});

test('rounds axis ticks to readable steps', () => {
  assert.deepEqual(axis(1500n), {maximum:1500,ticks:[{value:0,label:'0'},{value:500,label:'500'},{value:1000,label:'1k'},{value:1500,label:'1.5k'}]});
  assert.deepEqual(axis(1n).ticks.map(tick => tick.value), [0, 1]);
  assert.deepEqual(axis(3n).ticks.map(tick => tick.value), [0, 1, 2, 3]);
  assert.equal(axis(9n).maximum, 10);
  const big = axis(101200000n);
  assert.ok(big.maximum >= 101200000 && big.ticks.length <= 5);
  assert.equal(big.ticks.at(-1).label, '150M');
});

test('sorts model totals and folds only beyond the first eight', () => {
  const value = point(local(2024,1,1), usage('9550','1000','5000'), '10');
  value.models = Object.fromEntries(Array.from({length:10}, (_,index) => [`model-${index}`,usage(String(1000 - index * 10), '100', '500')]));
  const chart = heatmap([value], text), cell = chart.cells[0];
  assert.equal(cell.tooltip.title, '10.6k Token');
  assert.equal(cell.tooltip.rows.length, 9);
  assert.deepEqual(cell.tooltip.rows[0], {label:'model-0',value:'1.1k'});
  assert.deepEqual(cell.tooltip.rows[8], {label:'Other models',value:'2.0k'});
  assert.equal(cell.intensity, 1);
  assert.equal(chart.active, 1);
  value.models = {z:usage('1','1'),a:usage('1','1'),empty:usage('0','0')};
  assert.deepEqual(heatmap([value], text).cells[0].tooltip.rows.map(row => row.label), ['a','z']);
});

test('places local calendar cells without daylight-saving drift', () => {
  zone('America/New_York', () => {
    const points = days(local(2024,2,28), 35, () => null);
    const chart = heatmap(points, text);
    assert.equal(chart.rows, 7);
    assert.equal(chart.columns, 6);
    assert.deepEqual([chart.cells[0].column,chart.cells[0].row], [0,2]);
    assert.equal(chart.cells[1].tooltip.heading, '2024-02-29');
    assert.deepEqual([chart.cells[5].column,chart.cells[5].row], [1,0]);
    assert.equal(chart.cells[12].tooltip.heading, '2024-03-11');
    assert.equal(chart.cells[2].label_group, '2024-3');
    assert.equal(chart.cells[2].label, 'Month 3');
    assert.equal(chart.active, 0);
  });
});

test('retains one-row short ranges and square-root intensity', () => {
  const points = [point(local(2024,1,1),null),point(local(2024,1,2),null,'1'),point(local(2024,1,3),usage('1','0')),point(local(2024,1,4),usage('4','0')),point(local(2024,1,5),usage('9','0')),point(local(2024,1,6),usage('16','0'))];
  const chart = heatmap(points,text);
  assert.equal(chart.rows,1);
  assert.equal(chart.columns,6);
  assert.deepEqual(chart.cells.map(cell => cell.intensity),[0,0,0.25,0.45,0.7,1]);
  assert.deepEqual(chart.cells.map(cell => cell.column),[0,1,2,3,4,5]);
  assert.equal(chart.cells[0].tooltip.title,'0 Token');
  assert.equal(chart.cells[1].tooltip.title,'Unknown Token');
  assert.ok(chart.cells.every(cell => cell.row === 0 && cell.label_group === undefined));
  assert.doesNotThrow(() => JSON.stringify(chart));
});
