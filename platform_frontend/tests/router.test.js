// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isolateBrowserGlobals } from './helpers/browser-globals.js';
import { initRouter } from './helpers/router.js';

isolateBrowserGlobals();

/** @type {Record<string, Function[]>} */
const windowListeners = {};
/** @type {any} */ (globalThis).window = {
  addEventListener(/** @type {string} */ t, /** @type {Function} */ h) {
    (windowListeners[t] ??= []).push(h);
  },
};
/** @type {any} */ (globalThis).location = { hash: '' };

import { Router } from '../src/lib/router.js';

test('Router: mount is called with the route container and the route params', () => {
  const router = new Router();
  /** @type {any[]} */
  const writes = [];
  initRouter(
    router,
    /** @type {any} */ ({
      tagName: 'DIV',
      replaceChildren(/** @type {any[]} */ ...els) {
        writes.push(...els);
      },
    })
  );
  const calls =
    /** @type {Array<{el: any, params: Record<string, string>, tag: string}>} */ ([]);

  router.register('#/dashboard', {
    mount: (el, params) => {
      calls.push({ el, params, tag: el.tagName });
      el.replaceChildren('X');
    },
    unmount: () => {},
  });

  router.navigate('#/dashboard');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, { queryString: '' });
  assert.equal(calls[0].tag, 'DIV');
  assert.deepEqual(writes, ['X']);
});

test('Router: named param is extracted from hash pattern', () => {
  const router = new Router();
  initRouter(router, /** @type {any} */ ({}));
  /** @type {Record<string, string> | null} */
  let captured = null;

  router.register('#/case/:id', {
    mount: (_, params) => {
      captured = params;
    },
    unmount: () => {},
  });

  router.navigate('#/case/abc-123');
  assert.deepEqual(captured, { id: 'abc-123', queryString: '' });
});

test('Router: named params are decoded from hash path segments', () => {
  const router = new Router();
  initRouter(router, /** @type {any} */ ({}));
  /** @type {Record<string, string> | null} */
  let captured = null;

  router.register('#/case/:caseType/:id', {
    mount: (_, params) => {
      captured = params;
    },
    unmount: () => {},
  });

  router.navigate('#/case/product%20sale/case%2F123');
  assert.deepEqual(captured, {
    caseType: 'product sale',
    id: 'case/123',
    queryString: '',
  });
});

test('Router: multiple named params are extracted', () => {
  const router = new Router();
  initRouter(router, /** @type {any} */ ({}));
  /** @type {Record<string, string> | null} */
  let captured = null;

  router.register('#/org/:org/case/:id', {
    mount: (_, params) => {
      captured = params;
    },
    unmount: () => {},
  });

  router.navigate('#/org/acme/case/99');
  assert.deepEqual(captured, { org: 'acme', id: '99', queryString: '' });
});

test('Router: navigating away calls unmount before the next mount', () => {
  const router = new Router();
  initRouter(router, /** @type {any} */ ({}));
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
  initRouter(router, /** @type {any} */ ({}));

  assert.doesNotThrow(() => router.navigate('#/not-registered'));
});

test('Router: unregistered hash does not unmount the current view', () => {
  const router = new Router();
  initRouter(router, /** @type {any} */ ({}));
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
  initRouter(router, /** @type {any} */ ({}));
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
  // The router already split the query off to match the path, so it hands the
  // raw query string back rather than making the route read location.hash.
  assert.deepEqual(calls[0].params, {
    queryString: '?manager=me&status=overdue',
  });
});

test('Router: queryString keeps everything after the first ? verbatim, alongside named params', () => {
  const router = new Router();
  initRouter(router, /** @type {any} */ ({}));
  /** @type {Record<string, string> | null} */
  let captured = null;

  router.register('#/case/:id', {
    mount: (_, params) => {
      captured = params;
    },
    unmount: () => {},
  });

  // A '?' inside a parameter value belongs to the query, not to a second split.
  router.navigate('#/case/42?note=what%3F&raw=a?b');
  assert.deepEqual(captured, {
    id: '42',
    queryString: '?note=what%3F&raw=a?b',
  });
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
  initRouter(router, container);
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
  initRouter(router, container);
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
  initRouter(router, container);

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
  initRouter(router, container);
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

test('Router: a throwing unmount is isolated and does not block the next mount', async () => {
  const router = new Router();
  /** @type {any[]} */
  const children = [];
  const container = /** @type {any} */ ({
    replaceChildren(/** @type {any[]} */ ...els) {
      children.splice(0, children.length, ...els);
    },
  });
  initRouter(router, container);
  const origConsoleError = console.error;
  /** @type {any[]} */
  const errorCalls = [];
  console.error = (/** @type {any[]} */ ...args) => errorCalls.push(args);

  try {
    router.register('#/leaky', {
      mount: async (/** @type {any} */ el) => {
        el.replaceChildren({ tagName: 'LEAKY' });
      },
      unmount: () => {
        throw new Error('unmount boom');
      },
    });
    router.register('#/next', {
      mount: async (/** @type {any} */ el) => {
        el.replaceChildren({ tagName: 'NEXT' });
      },
      unmount: () => {},
    });

    await router.navigate('#/leaky');
    // Navigating away triggers the leaky unmount; it must not throw or stop the
    // next route from mounting.
    await router.navigate('#/next');

    assert.equal(children.length, 1);
    assert.equal(children[0].tagName, 'NEXT');
    assert.equal(errorCalls.length, 1, 'the failed unmount is logged');
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
  initRouter(router, container);
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
