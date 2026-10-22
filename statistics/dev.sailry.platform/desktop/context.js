import {grouped} from './format.js';
import {when} from './requests.js';

/** Context occupancy and the current policy keep their own model and capacity. */
export function details(state,text,now=Date.now()) {
  const statistics=state.statistics, unknown=text.context_no_data;
  const observed=statistics?.context_tokens, estimate=statistics?.context_estimate;
  const estimated=observed==null && estimate!=null, tokens=observed??estimate;
  const capacity=statistics?.context_limit, budget=statistics?.budget;
  const number=value=>grouped(value)??unknown;
  const measured=tokens!=null;
  const occupancy=measured ? `${estimated?text.context_approximately:''}${number(tokens)} / ${number(capacity)}` : unknown;
  const timestamp=value=>value==null ? null : when(value,now);
  const basis=measured ? text[estimated?'context_basis_estimate':'context_basis_observed'] : unknown;
  const rows=[
    {id:'occupancy',label:text.context_occupancy,value:occupancy},
    {id:'basis',label:text.context_basis,value:basis,
      note:measured ? [statistics?.context_model,timestamp(statistics?.context_timestamp_ms)].filter(Boolean).join(' · ') : ''},
    {id:'threshold',label:text.context_threshold,value:number(budget?.trigger_tokens),
      note:budget ? `${budget.model} · ${number(budget.context_limit)}` : ''},
    {id:'reserve',label:text.context_reserve,value:number(budget?.output_reserve)},
  ];
  const record=statistics?.last_compaction;
  const outcome=record?.outcome==='succeeded' ? text.context_succeeded
    : record?.outcome?.failed ? text.context_failed : unknown;
  rows.push({id:'compaction',label:text.context_last_compaction,value:outcome,
    note:timestamp(record?.timestamp_ms)??'',
    target:record && typeof record.id==='string' && record.id && record.turn && record.turn_sequence
      ? {entry:record.id,turn:record.turn,turn_sequence:record.turn_sequence} : null});
  return rows;
}
