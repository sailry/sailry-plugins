import {ResponseError} from '../errors.js';

export function day(now = Date.now()) {
  return new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0,10);
}

function document(input) {
  const value = typeof input.body === 'string' ? JSON.parse(input.body) : input.body;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid WorkBuddy check-in response');
  return value;
}

export function status(input) {
  const value = document(input);
  if (input.status < 200 || input.status >= 300 || value.code !== 0) throw new ResponseError(input.status,value);
  const data = value.data;
  const checked = data?.today_checked_in ?? data?.todayCheckedIn;
  if (typeof data?.active !== 'boolean' || typeof checked !== 'boolean') throw new Error('Invalid WorkBuddy check-in status');
  return {active:data.active,checked};
}

export function claimed(input) {
  const value = document(input);
  if (value.code === 10001) return {status:'already',credit:null};
  if (input.status < 200 || input.status >= 300 || value.code !== 0) throw new ResponseError(input.status,value);
  let credit = value.data?.credit;
  if (typeof credit === 'string' && /^[0-9]+(?:\.[0-9]+)?$/.test(credit)) credit = Number(credit);
  // A confirmed claim stays successful when its optional amount is absent.
  if (typeof credit !== 'number' || !Number.isFinite(credit) || credit < 0) credit = null;
  return {status:'claimed',credit};
}
