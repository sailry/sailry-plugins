import {fail, result} from './policy.js';
import {committed, identity} from './records.js';
import {prepare as scopeRequest} from './scope.js';
import {prepare as findingRequest} from './findings.js';
import {prepare as completionRequest, display} from './complete.js';
import {prepare as delegationRequest} from './delegation.js';
export {initialize} from './delegation.js';

function flow(prepare, present = value => value) {
  return async ({arguments:input,step,state,outcome}) => {
    try {
      if (step === 1) return {result:present(committed(outcome,state))};
      if (step !== 0) fail('Invalid review continuation');
      return await prepare(input,await identity());
    } catch (error) { return {result:result(error)}; }
  };
}
export const scope = flow(scopeRequest);
export const finding = flow(findingRequest);
export const complete = flow(completionRequest,display);

export async function delegate(input) {
  try { return await delegationRequest(input); }
  catch (error) { return result(error); }
}
