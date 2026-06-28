// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  afterMount,
  captureFocus,
  createLifecycle,
  defineView,
  on,
  reactive,
  restoreFocus,
} from '../src/lib/view.js';

test('view API: exports the future framework primitives', () => {
  assert.equal(typeof defineView, 'function');
  assert.equal(typeof reactive, 'function');
  assert.equal(typeof createLifecycle, 'function');
  assert.equal(typeof on, 'function');
  assert.equal(typeof afterMount, 'function');
  assert.equal(typeof captureFocus, 'function');
  assert.equal(typeof restoreFocus, 'function');
});

test.todo('reactive: renders a plain function component into a host node');

test.todo('reactive: re-renders when signals read by render change');

test.todo('reactive: disposes render effects when the host disconnects');

test.todo('reactive: supports local signal state inside function components');

test.todo('defineView: remains available for custom-element shell boundaries');

test('on: removes registered listeners when the owning lifecycle disconnects', () => {
  const lifecycle = createLifecycle();
  const target = new EventTarget();
  let calls = 0;
  const listener = () => calls++;

  lifecycle.run(() => on(target, 'ping', listener));

  target.dispatchEvent(new Event('ping'));
  assert.equal(calls, 1);

  lifecycle.disconnect();
  target.dispatchEvent(new Event('ping'));
  assert.equal(calls, 1);
});

test('on: resolves lazy listener targets inside the owning lifecycle', () => {
  const lifecycle = createLifecycle();
  const target = new EventTarget();
  let calls = 0;

  lifecycle.run(() =>
    on(
      () => target,
      'ping',
      () => calls++
    )
  );
  target.dispatchEvent(new Event('ping'));

  assert.equal(calls, 1);
});

test('on: throws when called without an owning lifecycle', () => {
  assert.throws(
    () => on(new EventTarget(), 'ping', () => {}),
    /on\(\) must be called while a view is mounting/
  );
});

test('afterMount: runs registered hooks on mount and disposes returned cleanup', () => {
  const lifecycle = createLifecycle();
  let mounts = 0;
  let cleanups = 0;

  lifecycle.run(() =>
    afterMount(() => {
      mounts++;
      return () => cleanups++;
    })
  );

  assert.equal(mounts, 0);
  lifecycle.mount();
  lifecycle.mount();
  assert.equal(mounts, 1);
  assert.equal(cleanups, 0);

  lifecycle.disconnect();
  assert.equal(cleanups, 1);
});

test('afterMount: runs hooks inside the owning lifecycle', () => {
  const lifecycle = createLifecycle();
  const target = new EventTarget();
  let calls = 0;

  lifecycle.run(() =>
    afterMount(() => {
      on(target, 'ping', () => calls++);
    })
  );

  lifecycle.mount();
  target.dispatchEvent(new Event('ping'));
  assert.equal(calls, 1);

  lifecycle.disconnect();
  target.dispatchEvent(new Event('ping'));
  assert.equal(calls, 1);
});

test('afterMount: throws when called without an owning lifecycle', () => {
  assert.throws(
    () => afterMount(() => {}),
    /afterMount\(\) must be called while a view is mounting/
  );
});

test.todo('captureFocus/restoreFocus: preserves data-focus-key and selection');
