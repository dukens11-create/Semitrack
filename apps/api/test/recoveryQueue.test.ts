import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { createRecoveryQueue } from '../dist/services/recoveryQueue.js';

test('recovery admission happens before account/provider work; bounded queue drains without exposing errors', async () => {
  let calls=0, failures=0;
  let release: () => void = () => {};
  const blocked = new Promise<void>(resolve => { release=resolve; });
  const enqueue = createRecoveryQueue(() => { failures++; },2,1);
  assert.equal(enqueue(async () => {calls++; await blocked;}),true);
  assert.equal(enqueue(async () => {calls++; throw Error('private account detail');}),true);
  assert.equal(enqueue(async () => {assert.fail();}),false);
  assert.equal(calls,0);
  await nextTurn();
  assert.equal(calls,1);
  release(); await nextTurn();
  assert.equal(calls,2); assert.equal(failures,1);
  assert.equal(enqueue(async () => {calls++;}),true);
  await nextTurn(); assert.equal(calls,3);
});
