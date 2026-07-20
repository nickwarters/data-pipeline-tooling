// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isolateBrowserGlobals } from './helpers/browser-globals.js';
import { initRouter, routeRegistrationSpy } from './helpers/router.js';

isolateBrowserGlobals();

/** @type {Record<string, Function[]>} */
const windowListeners = {};
/** @type {any} */ (globalThis).window = {
  addEventListener(
    /** @type {string} */ type,
    /** @type {Function} */ handler
  ) {
    (windowListeners[type] ??= []).push(handler);
  },
};
/** @type {any} */ (globalThis).location = { hash: '' };

import { Router } from '../src/lib/router.js';
import { register } from '../src/routes/question-bank.js';

test('question-bank route registers the store-driven page', () => {
  const registration = routeRegistrationSpy();
  register(
    /** @type {any} */ (registration.router),
    /** @type {any} */ ({ appEl: { classList: { add() {}, remove() {} } } })
  );
  assert.equal(registration.has('#/question-bank'), true);
});

test('question-bank route contains a rejecting page loader', async () => {
  const originalDocument = /** @type {any} */ (globalThis).document;
  const originalError = console.error;
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
  console.error = () => {};
  try {
    /** @type {any[]} */
    const rendered = [];
    const router = new Router();
    initRouter(
      router,
      /** @type {any} */ ({
        replaceChildren(/** @type {any[]} */ ...elements) {
          rendered.push(...elements);
        },
      })
    );
    register(
      router,
      /** @type {any} */ ({
        appEl: { classList: { add() {}, remove() {} } },
        loadQuestionBankEditor: () => Promise.reject(new Error('boom')),
      })
    );
    await router.navigate('#/question-bank');
    assert.ok(
      rendered.some((element) => element.className === 'cora-route-error')
    );
  } finally {
    /** @type {any} */ (globalThis).document = originalDocument;
    console.error = originalError;
  }
});
