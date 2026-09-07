import assert from 'node:assert/strict';
import test from 'node:test';

import { createQueuedSingleFlight } from '../lib/queuedSingleFlight';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

test('calls made during an active check collapse into one trailing check with the latest context', async () => {
  const firstGate = deferred<number>();
  const calls: string[] = [];
  const run = createQueuedSingleFlight(async (language: string) => {
    calls.push(language);
    return calls.length === 1 ? firstGate.promise : calls.length;
  });

  const first = run('en');
  const afterSave = run('de');
  const afterEdit = run('fr');
  assert.equal(afterSave, afterEdit);
  assert.deepEqual(calls, ['en']);

  firstGate.resolve(1);
  assert.equal(await first, 1);
  assert.equal(await afterSave, 2);
  assert.deepEqual(calls, ['en', 'fr']);
});

test('a failed active check still releases the queued save check and future checks', async () => {
  const gate = deferred<number>();
  let calls = 0;
  const run = createQueuedSingleFlight(async () => {
    calls += 1;
    if (calls === 1) return gate.promise;
    return calls;
  });
  const first = run(undefined);
  const trailing = run(undefined);
  gate.reject(new Error('network unavailable'));
  await assert.rejects(first, /network unavailable/);
  assert.equal(await trailing, 2);
  assert.equal(await run(undefined), 3);
});
