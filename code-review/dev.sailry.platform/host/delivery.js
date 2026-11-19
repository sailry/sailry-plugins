import {callId,context,readTurnState,stageTurnState} from 'sailry/sdk';
import {limits,size} from './policy.js';

export const deliveryBytes = 128;
const key = (id,path,revision) => JSON.stringify([id,path,revision]);

function turn() {
  const scope = context();
  return scope.turn && !scope.invocation ? readTurnState() : null;
}

function merge(ranges) {
  ranges.sort((left,right) => left[0]-right[0]);
  const merged = [];
  for (const [start,end] of ranges) {
    const previous = merged.at(-1);
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1],end);
    else merged.push([start,end]);
  }
  return merged;
}

export function delivered(id,changes) {
  const diffs = changes.filter(page => page.part === 'diff');
  if (!diffs.length) return {};
  const state = turn();
  if (!state) return {};
  const coverage = state.diff_delivery ?? {sequence:0,files:{},tokens:[]};
  const sequence = coverage.sequence+1;
  for (const page of diffs) {
    const name = key(id,page.path,page.revision);
    const previous = coverage.files[name];
    if (typeof previous === 'number') continue;
    const end = page.offset+page.lines.length;
    const terminal = page.next === null ? end : previous?.terminal ?? null;
    const ranges = merge([...(previous?.ranges ?? []),[page.offset,end]]);
    coverage.files[name] = terminal !== null && ranges[0][0] === 0 && ranges[0][1] >= terminal
      ? sequence : {terminal,ranges};
  }
  // A token from the tool result covers only pages delivered when that result was built.
  // An earlier token cannot claim pages read later in the same tool batch as completion.
  const token = callId();
  coverage.sequence = sequence;
  coverage.tokens = [...coverage.tokens.slice(-63),{id,token,sequence}];
  // Large or retained reviews can use explicit file attestations when turn state is unavailable.
  if (size(coverage) > limits.output) return {};
  stageTurnState({...state,diff_delivery:coverage});
  return {delivery_token:token,delivery_sequence:sequence};
}

export function missingDelivery(id,token,files) {
  if (!files.length) return [];
  const coverage = turn()?.diff_delivery;
  const proof = coverage?.tokens.find(candidate => candidate.id === id && candidate.token === token);
  if (!proof) return files;
  return files.filter(file => {
    const sequence = coverage.files[key(id,file.path,file.revision)];
    return typeof sequence !== 'number' || sequence > proof.sequence;
  });
}
