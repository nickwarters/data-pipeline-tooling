// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Router } from '../src/router.js';

test('Router: mount is called when navigating to a registered static hash', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  const calls = /** @type {Array<{el: unknown, params: Record<string, string>}>} */ ([]);

  router.register('#/dashboard', {
    mount: (el, params) => calls.push({ el, params }),
    unmount: () => {},
  });

  router.navigate('#/dashboard');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].el, router._container);
  assert.deepEqual(calls[0].params, {});
});

test('Router: named param is extracted from hash pattern', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  /** @type {Record<string, string> | null} */
  let captured = null;

  router.register('#/case/:id', {
    mount: (_, params) => { captured = params; },
    unmount: () => {},
  });

  router.navigate('#/case/abc-123');
  assert.deepEqual(captured, { id: 'abc-123' });
});

test('Router: multiple named params are extracted', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  /** @type {Record<string, string> | null} */
  let captured = null;

  router.register('#/org/:org/case/:id', {
    mount: (_, params) => { captured = params; },
    unmount: () => {},
  });

  router.navigate('#/org/acme/case/99');
  assert.deepEqual(captured, { org: 'acme', id: '99' });
});

test('Router: navigating away calls unmount before the next mount', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  /** @type {string[]} */
  const log = [];

  router.register('#/dashboard', {
    mount: () => log.push('mount:dashboard'),
    unmount: () => log.push('unmount:dashboard'),
  });
  router.register('#/case/:id', {
    mount: (_, p) => log.push(`mount:case:${p.id}`),
    unmount: () => log.push('unmount:case'),
  });

  router.navigate('#/dashboard');
  router.navigate('#/case/42');
  assert.deepEqual(log, ['mount:dashboard', 'unmount:dashboard', 'mount:case:42']);
});

test('Router: navigating to an unregistered hash is a no-op', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});

  assert.doesNotThrow(() => router.navigate('#/not-registered'));
});

test('Router: unregistered hash does not unmount the current view', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  /** @type {string[]} */
  const log = [];

  router.register('#/dashboard', {
    mount: () => log.push('mount'),
    unmount: () => log.push('unmount'),
  });

  router.navigate('#/dashboard');
  router.navigate('#/not-registered');
  assert.deepEqual(log, ['mount']);
});
