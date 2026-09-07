import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  environmentFetchMaximumTimeoutMs,
  runEnvironmentFetch,
} from '../../scripts/lib/environment-fetch.mjs';

test('environment fetch passes an abort signal and cancels its timer on success', async () => {
  const scheduled = [];
  const cancelled = [];
  let signal;
  const result = await runEnvironmentFetch(
    'https://go.dev/dl/?mode=json&include=all',
    async (response) => response.value,
    {
      timeoutMs: 2_000,
      fetchImpl: async (_url, options) => {
        signal = options.signal;
        return { value: 'ok' };
      },
      schedule: (callback, timeoutMs) => {
        scheduled.push({ callback, timeoutMs });
        return 'timer';
      },
      cancel: (timer) => cancelled.push(timer),
    },
  );

  assert.equal(result, 'ok');
  assert.ok(signal instanceof AbortSignal);
  assert.equal(signal.aborted, false);
  assert.deepEqual(scheduled.map(({ timeoutMs }) => timeoutMs), [2_000]);
  assert.deepEqual(cancelled, ['timer']);
});

test('environment fetch aborts an in-flight request and normalizes timeout failure', async () => {
  let triggerTimeout;
  const pending = runEnvironmentFetch(
    'https://go.dev/dl/go.tar.gz',
    async () => new Promise(() => {}),
    {
      timeoutMs: 5_000,
      fetchImpl: async (_url, { signal }) => {
        await new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => {
            assert.equal(signal.aborted, true);
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          }, { once: true });
        });
      },
      schedule: (callback) => {
        triggerTimeout = callback;
        return 'timer';
      },
      cancel: () => {},
    },
  );

  triggerTimeout();
  await assert.rejects(
    pending,
    (error) => error.name === 'EnvironmentFetchTimeoutError' && error.code === 'ETIMEDOUT',
  );
});

test('environment fetch validates timeout and preserves non-timeout failures', async () => {
  for (const timeoutMs of [undefined, 0, -1, 1.5, Number.NaN, environmentFetchMaximumTimeoutMs + 1]) {
    await assert.rejects(
      runEnvironmentFetch('https://go.dev/dl', async () => null, { timeoutMs, fetchImpl: async () => ({}) }),
      /Environment fetch timeout must be a safe integer/,
    );
  }

  const networkError = new Error('network unavailable');
  await assert.rejects(
    runEnvironmentFetch('https://go.dev/dl', async () => null, {
      timeoutMs: 1_000,
      fetchImpl: async () => { throw networkError; },
      schedule: () => 'timer',
      cancel: () => {},
    }),
    networkError,
  );
});
