export function amount(value) {
  return (value ?? 0).toFixed(2).replace(/\.00$/,'').replace(/(\.\d)0$/,'$1');
}

function time(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid provider usage reset');
  const pad = value => String(value).padStart(2,'0');
  return `${String(date.getFullYear()).padStart(4,'0')}-${pad(date.getMonth()+1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function metric(snapshot,text) {
  if (!snapshot || (!snapshot.windows.length && !snapshot.credits && !snapshot.extra)) return {value:null,details:[]};
  const measured = snapshot.windows.map(window=>window.used).filter(value=>value != null);
  const details = [];
  for (const window of snapshot.windows) {
    const label = text[window.key];
    details.push({label:{label},value:`${amount(window.used)}%`,
      ...(window.used == null ? {} : {progress:Math.min(100,window.used)})});
    if (window.reset != null) details.push({label:{label:text.resets},value:time(window.reset)});
  }
  if (snapshot.credits) details.push({label:{label:text.credits},
    value:snapshot.credits.unlimited === true ? text.unlimited : amount(snapshot.credits.balance)});
  if (snapshot.extra) {
    // Claude's extra_usage amounts use minor currency units, unlike dollar windows.
    details.push({label:{label:text.extra},value:`${amount(snapshot.extra.used == null ? null : snapshot.extra.used / 100)} / ${amount(snapshot.extra.limit == null ? null : snapshot.extra.limit / 100)}${snapshot.extra.currency ? ` ${snapshot.extra.currency}` : ''}`});
  }
  return {value:`${amount(measured.length ? Math.max(...measured) : null)}%`,details};
}
