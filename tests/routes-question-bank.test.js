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
import { register } from '../src/routes/question-bank.js';

/** @returns {Promise<void>} */
async function tick() {
  await Promise.resolve();
}

test('question-bank route: register calls router.register with #/question-bank', () => {
  const router = new Router();
  router._container = /** @type {any} */ ({});
  const appEl = { classList: { add() {}, remove() {} } };
  register(router, /** @type {any} */ ({ appEl }));
  assert.ok(
    router._routes.some((r) => r.re.test('#/question-bank')),
    '#/question-bank should be registered'
  );
});

test('question-bank route: a rejecting editor loader yields cora-route-error', async () => {
  const appEl = { classList: { add() {}, remove() {} } };

  const origDoc = /** @type {any} */ (globalThis).document;
  /** @type {any} */ (globalThis).document = {
    createElement(/** @type {string} */ tag) {
      return {
        tagName: tag,
        className: '',
        textContent: '',
        setAttribute() {},
        appendChild(/** @type {any} */ child) {
          return child;
        },
      };
    },
    createTreeWalker() {
      return {
        nextNode() {
          return null;
        },
      };
    },
  };
  const origError = console.error;
  console.error = () => {};

  try {
    /** @type {any[]} */
    const rendered = [];
    const router = new Router();
    router._container = /** @type {any} */ ({
      replaceChildren(/** @type {any} */ ...els) {
        rendered.push(...els);
      },
    });
    register(
      router,
      /** @type {any} */ ({
        appEl,
        loadQuestionBankEditor: () => Promise.reject(new Error('boom')),
      })
    );
    await router.navigate('#/question-bank');
    assert.ok(
      rendered.some((el) => el.className === 'cora-route-error'),
      'a cora-route-error panel should be rendered'
    );
  } finally {
    /** @type {any} */ (globalThis).document = origDoc;
    console.error = origError;
  }
});

test('question-bank route: mount adds cora-fullbleed to appEl', async () => {
  const added = /** @type {string[]} */ ([]);
  const appEl = {
    classList: {
      add(/** @type {string} */ c) {
        added.push(c);
      },
      remove() {},
    },
  };

  const origDoc = /** @type {any} */ (globalThis).document;
  /** @type {any} */ (globalThis).document = {
    createElement(/** @type {string} */ tag) {
      return { setAttribute() {} };
    },
    createTreeWalker() {
      return {
        nextNode() {
          return null;
        },
      };
    },
  };

  try {
    const router = new Router();
    router._container = /** @type {any} */ ({ replaceChildren() {} });
    register(
      router,
      /** @type {any} */ ({
        appEl,
        loadQuestionBankEditor: () => Promise.resolve(),
      })
    );
    router.navigate('#/question-bank');
    await tick();
    assert.ok(
      added.includes('cora-fullbleed'),
      'cora-fullbleed should be added on mount'
    );
  } finally {
    /** @type {any} */ (globalThis).document = origDoc;
  }
});

test('question-bank route: unmount removes cora-fullbleed from appEl', async () => {
  const removed = /** @type {string[]} */ ([]);
  const appEl = {
    classList: {
      add() {},
      remove(/** @type {string} */ c) {
        removed.push(c);
      },
    },
  };

  const origDoc = /** @type {any} */ (globalThis).document;
  /** @type {any} */ (globalThis).document = {
    createElement(/** @type {string} */ tag) {
      return { setAttribute() {} };
    },
    createTreeWalker() {
      return {
        nextNode() {
          return null;
        },
      };
    },
  };

  try {
    const router2 = new Router();
    router2._container = /** @type {any} */ ({ replaceChildren() {} });
    register(
      router2,
      /** @type {any} */ ({
        appEl,
        loadQuestionBankEditor: () => Promise.resolve(),
      })
    );
    router2.register('#/dashboard', { mount() {}, unmount() {} });
    router2.navigate('#/question-bank');
    await tick();
    router2.navigate('#/dashboard');
    assert.ok(
      removed.includes('cora-fullbleed'),
      'cora-fullbleed should be removed on unmount'
    );
  } finally {
    /** @type {any} */ (globalThis).document = origDoc;
  }
});

test('question-bank route: mount creates cora-bank-editor element', async () => {
  const created = /** @type {string[]} */ ([]);
  const appEl = { classList: { add() {}, remove() {} } };

  const origDoc = /** @type {any} */ (globalThis).document;
  /** @type {any} */ (globalThis).document = {
    createElement(/** @type {string} */ tag) {
      created.push(tag);
      return { setAttribute() {} };
    },
    createTreeWalker() {
      return {
        nextNode() {
          return null;
        },
      };
    },
  };

  try {
    const router = new Router();
    router._container = /** @type {any} */ ({ replaceChildren() {} });
    register(
      router,
      /** @type {any} */ ({
        appEl,
        loadQuestionBankEditor: () => Promise.resolve(),
      })
    );
    router.navigate('#/question-bank');
    await tick();
    assert.ok(
      created.includes('cora-bank-editor'),
      'cora-bank-editor should be created on mount'
    );
  } finally {
    /** @type {any} */ (globalThis).document = origDoc;
  }
});

test('question-bank route: mount loads simulator sample cases after the editor', async () => {
  const appEl = { classList: { add() {}, remove() {} } };

  const origDoc = /** @type {any} */ (globalThis).document;
  /** @type {any} */ (globalThis).document = {
    createElement() {
      return { setAttribute() {} };
    },
    createTreeWalker() {
      return {
        nextNode() {
          return null;
        },
      };
    },
  };

  const origSearch = /** @type {any} */ (globalThis).location.search;
  /** @type {any} */ (globalThis).location.search = '?simulate=1';

  try {
    let samplesLoaded = 0;
    const router = new Router();
    router._container = /** @type {any} */ ({ replaceChildren() {} });
    register(
      router,
      /** @type {any} */ ({
        appEl,
        loadQuestionBankEditor: () => Promise.resolve(),
        loadQuestionBankSamples: () => {
          samplesLoaded++;
          return Promise.resolve();
        },
      })
    );
    await router.navigate('#/question-bank');
    assert.equal(samplesLoaded, 1);
  } finally {
    /** @type {any} */ (globalThis).document = origDoc;
    /** @type {any} */ (globalThis).location.search = origSearch;
  }
});

test('question-bank route: sample cases are not loaded without ?simulate=1', async () => {
  const appEl = { classList: { add() {}, remove() {} } };

  const origDoc = /** @type {any} */ (globalThis).document;
  /** @type {any} */ (globalThis).document = {
    createElement() {
      return { setAttribute() {} };
    },
    createTreeWalker() {
      return {
        nextNode() {
          return null;
        },
      };
    },
  };

  try {
    let samplesLoaded = 0;
    const router = new Router();
    router._container = /** @type {any} */ ({ replaceChildren() {} });
    register(
      router,
      /** @type {any} */ ({
        appEl,
        loadQuestionBankEditor: () => Promise.resolve(),
        loadQuestionBankSamples: () => {
          samplesLoaded++;
          return Promise.resolve();
        },
      })
    );
    router.navigate('#/question-bank');
    await tick();
    assert.equal(samplesLoaded, 0);
  } finally {
    /** @type {any} */ (globalThis).document = origDoc;
  }
});

test('question-bank route: default sample loader fetches through context.client', async () => {
  const appEl = { classList: { add() {}, remove() {} } };

  const origDoc = /** @type {any} */ (globalThis).document;
  /** @type {any} */ (globalThis).document = {
    createElement() {
      return { setAttribute() {} };
    },
    createTreeWalker() {
      return {
        nextNode() {
          return null;
        },
      };
    },
  };
  const origSearch = /** @type {any} */ (globalThis).location.search;
  /** @type {any} */ (globalThis).location.search = '?simulate=1';

  try {
    /** @type {string[]} */
    const asked = [];
    /** @type {any[]} */
    const opts = [];
    const client = {
      async listCases(/** @type {any} */ filter, /** @type {any} */ o) {
        asked.push(filter.caseType);
        opts.push(o);
        return [];
      },
    };
    const caseSources = [
      {
        slug: 'example-review',
        listName: 'Cases-ExampleReview',
        displayName: 'Example Review',
      },
    ];
    const router = new Router();
    router._container = /** @type {any} */ ({ replaceChildren() {} });
    register(
      router,
      /** @type {any} */ ({
        appEl,
        client,
        caseSources,
        loadQuestionBankEditor: () => Promise.resolve(),
      })
    );
    router.navigate('#/question-bank');
    // Let the dynamic import + listCases round-trips settle. The import chain
    // includes real file I/O (the bank artifact behind question-bank-source),
    // so wait on a deadline rather than a fixed number of ticks.
    const deadline = Date.now() + 2000;
    while (asked.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(asked.includes('example-review'));
    assert.equal(
      opts[0]?.listName,
      'Cases-ExampleReview',
      'the read carries the source listName'
    );
  } finally {
    /** @type {any} */ (globalThis).document = origDoc;
    /** @type {any} */ (globalThis).location.search = origSearch;
  }
});
