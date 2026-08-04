// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { isAbortError, ignoreAbortError } = await import('../src/lib/abort.js');

test('abort: an AbortController reason is recognised as an abort', () => {
  const controller = new AbortController();
  controller.abort();
  assert.equal(isAbortError(controller.signal.reason), true);
});

test('abort: a plain Error named AbortError is recognised', () => {
  const error = new Error('aborted');
  error.name = 'AbortError';
  assert.equal(isAbortError(error), true);
});

test('abort: an ordinary failure is not an abort', () => {
  assert.equal(isAbortError(new Error('HTTP Error: 403')), false);
  assert.equal(isAbortError('AbortError'), false);
  assert.equal(isAbortError(null), false);
  assert.equal(isAbortError(undefined), false);
});

test('abort: ignoreAbortError swallows an abort and rethrows anything else', async () => {
  const controller = new AbortController();
  controller.abort();

  await assert.doesNotReject(
    Promise.reject(controller.signal.reason).catch(ignoreAbortError)
  );

  const real = new Error('HTTP Error: 403');
  await assert.rejects(
    Promise.reject(real).catch(ignoreAbortError),
    /HTTP Error: 403/
  );
});
