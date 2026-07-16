// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

/** @type {Record<string, Function[]>} */
const windowListeners = {};
/** @type {any} */ (globalThis).window = {
  addEventListener(/** @type {string} */ t, /** @type {Function} */ h) {
    (windowListeners[t] ??= []).push(h);
  },
};
/** @type {any} */ (globalThis).location = { hash: '' };

import { Router } from '../src/lib/router.js';

test('Router: mount is called when navigating to a registered static hash', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  const calls =
    /** @type {Array<{el: unknown, params: Record<string, string>}>} */ ([]);

  router.register('#/dashboard', {
    mount: (el, params) => {
      calls.push({ el, params });
    },
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
    mount: (_, params) => {
      captured = params;
    },
    unmount: () => {},
  });

  router.navigate('#/case/abc-123');
  assert.deepEqual(captured, { id: 'abc-123' });
});

test('Router: named params are decoded from hash path segments', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  /** @type {Record<string, string> | null} */
  let captured = null;

  router.register('#/case/:caseType/:id', {
    mount: (_, params) => {
      captured = params;
    },
    unmount: () => {},
  });

  router.navigate('#/case/product%20sale/case%2F123');
  assert.deepEqual(captured, { caseType: 'product sale', id: 'case/123' });
});

test('Router: multiple named params are extracted', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  /** @type {Record<string, string> | null} */
  let captured = null;

  router.register('#/org/:org/case/:id', {
    mount: (_, params) => {
      captured = params;
    },
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
    mount: () => {
      log.push('mount:dashboard');
    },
    unmount: () => log.push('unmount:dashboard'),
  });
  router.register('#/case/:id', {
    mount: (_, p) => {
      log.push(`mount:case:${p.id}`);
    },
    unmount: () => log.push('unmount:case'),
  });

  router.navigate('#/dashboard');
  router.navigate('#/case/42');
  assert.deepEqual(log, [
    'mount:dashboard',
    'unmount:dashboard',
    'mount:case:42',
  ]);
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
    mount: () => {
      log.push('mount');
    },
    unmount: () => log.push('unmount'),
  });

  router.navigate('#/dashboard');
  router.navigate('#/not-registered');
  assert.deepEqual(log, ['mount']);
});

test('Router: init sets container, registers hashchange listener, and navigates to current hash', () => {
  const router = new Router();
  const container = /** @type {any} */ ({});
  /** @type {string[]} */
  const log = [];

  router.register('#/', {
    mount: (el, params) => {
      log.push(`mount:root`);
    },
    unmount: () => log.push('unmount:root'),
  });

  /** @type {any} */ (globalThis).location.hash = '#/';
  router.init(container);

  assert.equal(router._container, container);
  assert.ok(
    windowListeners['hashchange']?.length > 0,
    'hashchange listener should be registered'
  );
  assert.deepEqual(log, ['mount:root']);
});

test('Router: init with empty hash navigates to #/', () => {
  const router = new Router();
  const container = /** @type {any} */ ({});
  /** @type {string[]} */
  const log = [];

  router.register('#/', {
    mount: () => {
      log.push('mount:root');
    },
    unmount: () => {},
  });

  /** @type {any} */ (globalThis).location.hash = '';
  router.init(container);

  assert.deepEqual(log, ['mount:root']);
});

test('Router: route matches hash that has query params appended', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  const calls =
    /** @type {Array<{el: unknown, params: Record<string, string>}>} */ ([]);

  router.register('#/team-cases', {
    mount: (el, params) => {
      calls.push({ el, params });
    },
    unmount: () => {},
  });

  router.navigate('#/team-cases?manager=me&status=overdue');
  assert.equal(calls.length, 1, 'should match even with query params in hash');
});

test('Router: a rejecting async mount renders a cora-route-error panel into the container', async () => {
  const router = new Router();
  /** @type {any[]} */
  const children = [];
  const container = /** @type {any} */ ({
    replaceChildren(/** @type {any[]} */ ...els) {
      children.splice(0, children.length, ...els);
    },
  });
  router._container = container;
  const origCreateElement = /** @type {any} */ (globalThis).document
    ?.createElement;
  /** @type {any} */ (globalThis).document = {
    createElement(/** @type {string} */ tag) {
      return {
        tagName: tag.toUpperCase(),
        className: '',
        textContent: '',
        _children: /** @type {any[]} */ ([]),
        appendChild(/** @type {any} */ child) {
          this._children.push(child);
          return child;
        },
      };
    },
  };
  const origConsoleError = console.error;
  console.error = () => {};

  try {
    router.register('#/broken', {
      mount: async () => {
        throw new Error('boom');
      },
      unmount: () => {},
    });

    await router.navigate('#/broken');

    assert.equal(children.length, 1);
    assert.equal(children[0].className, 'cora-route-error');
  } finally {
    console.error = origConsoleError;
    if (origCreateElement) {
      /** @type {any} */ (globalThis).document.createElement =
        origCreateElement;
    } else {
      delete (/** @type {any} */ (globalThis).document);
    }
  }
});

test('Router: a rejecting async mount logs the failure via console.error mentioning the hash', async () => {
  const router = new Router();
  const container = /** @type {any} */ ({ replaceChildren() {} });
  router._container = container;
  const origCreateElement = /** @type {any} */ (globalThis).document
    ?.createElement;
  /** @type {any} */ (globalThis).document = {
    createElement(/** @type {string} */ tag) {
      return {
        tagName: tag.toUpperCase(),
        className: '',
        textContent: '',
        _children: /** @type {any[]} */ ([]),
        appendChild(/** @type {any} */ child) {
          this._children.push(child);
          return child;
        },
      };
    },
  };
  /** @type {any[]} */
  const errorCalls = [];
  const origConsoleError = console.error;
  console.error = (/** @type {any[]} */ ...args) => errorCalls.push(args);

  try {
    router.register('#/broken', {
      mount: async () => {
        throw new Error('boom');
      },
      unmount: () => {},
    });

    await router.navigate('#/broken');

    assert.equal(errorCalls.length, 1);
    assert.ok(
      errorCalls[0].some(
        (/** @type {any} */ arg) =>
          typeof arg === 'string' && arg.includes('#/broken')
      ),
      'console.error should mention the failing hash'
    );
  } finally {
    console.error = origConsoleError;
    if (origCreateElement) {
      /** @type {any} */ (globalThis).document.createElement =
        origCreateElement;
    } else {
      delete (/** @type {any} */ (globalThis).document);
    }
  }
});

test('Router: an async mount that resolves renders normally with no error panel', async () => {
  const router = new Router();
  /** @type {any[]} */
  const children = [];
  const container = /** @type {any} */ ({
    replaceChildren(/** @type {any[]} */ ...els) {
      children.splice(0, children.length, ...els);
    },
  });
  router._container = container;

  router.register('#/ok', {
    mount: async (el) => {
      await Promise.resolve();
      /** @type {any} */ (el).replaceChildren({ tagName: 'SECTION' });
    },
    unmount: () => {},
  });

  await router.navigate('#/ok');

  assert.equal(children.length, 1);
  assert.equal(children[0].tagName, 'SECTION');
});

test('Router: a stale rejecting navigate does not clobber a newer successful navigate', async () => {
  const router = new Router();
  /** @type {any[]} */
  const children = [];
  const container = /** @type {any} */ ({
    replaceChildren(/** @type {any[]} */ ...els) {
      children.splice(0, children.length, ...els);
    },
  });
  router._container = container;
  const origConsoleError = console.error;
  console.error = () => {};

  /** @type {{ reject: (err: Error) => void } | null} */
  let slowReject = null;

  try {
    router.register('#/slow', {
      mount: () =>
        new Promise((_resolve, reject) => {
          slowReject = { reject };
        }),
      unmount: () => {},
    });
    router.register('#/fast', {
      mount: async (el) => {
        /** @type {any} */ (el).replaceChildren({ tagName: 'FAST' });
      },
      unmount: () => {},
    });

    const p1 = router.navigate('#/slow');
    await router.navigate('#/fast');

    assert.equal(children.length, 1);
    assert.equal(children[0].tagName, 'FAST');

    /** @type {any} */ (slowReject).reject(new Error('stale boom'));
    await p1;

    assert.equal(children.length, 1);
    assert.equal(children[0].tagName, 'FAST');
    assert.notEqual(children[0].className, 'cora-route-error');
  } finally {
    console.error = origConsoleError;
  }
});

test('Router: a mount that throws synchronously also renders a cora-route-error panel', async () => {
  const router = new Router();
  /** @type {any[]} */
  const children = [];
  const container = /** @type {any} */ ({
    replaceChildren(/** @type {any[]} */ ...els) {
      children.splice(0, children.length, ...els);
    },
  });
  router._container = container;
  const origCreateElement = /** @type {any} */ (globalThis).document
    ?.createElement;
  /** @type {any} */ (globalThis).document = {
    createElement(/** @type {string} */ tag) {
      return {
        tagName: tag.toUpperCase(),
        className: '',
        textContent: '',
        _children: /** @type {any[]} */ ([]),
        appendChild(/** @type {any} */ child) {
          this._children.push(child);
          return child;
        },
      };
    },
  };
  const origConsoleError = console.error;
  console.error = () => {};

  try {
    router.register('#/sync-throw', {
      mount: () => {
        throw new Error('sync boom');
      },
      unmount: () => {},
    });

    await router.navigate('#/sync-throw');

    assert.equal(children.length, 1);
    assert.equal(children[0].className, 'cora-route-error');
  } finally {
    console.error = origConsoleError;
    if (origCreateElement) {
      /** @type {any} */ (globalThis).document.createElement =
        origCreateElement;
    } else {
      delete (/** @type {any} */ (globalThis).document);
    }
  }
});

test('Router: hashchange event triggers navigation', () => {
  const router = new Router();
  const container = /** @type {any} */ ({});
  /** @type {string[]} */
  const log = [];

  router.register('#/dashboard', {
    mount: () => {
      log.push('mount:dashboard');
    },
    unmount: () => log.push('unmount:dashboard'),
  });

  /** @type {any} */ (globalThis).location.hash = '';
  router.init(container);

  /** @type {any} */ (globalThis).location.hash = '#/dashboard';
  (windowListeners['hashchange'] ?? []).forEach((fn) => fn());

  assert.ok(log.includes('mount:dashboard'));
});
