import {nextChange} from 'sailry/sdk';
import {context} from 'sailry';

// Visibility belongs to the captured host; hidden views retain results without polling.
export function observeVisibility(owner,cx) {
  owner.visible=false;
  owner.wake=()=>{
    if (!owner.visible || !owner.state?.connected) return;
    owner.refresh(cx);owner.ensure?.(cx);
  };
  const scope=JSON.parse(context()).worktree ? 'settled' : 'package';
  cx.spawn(async ()=>{
    let cursor='';
    try {while (true) {
      const change=await nextChange(cursor,scope);cursor=change.cursor;
      owner.visible=change.visible!==false && change.connected;
      owner.wake();
    }} catch (_) { /* View release ends visibility observation. */ }
  });
}
