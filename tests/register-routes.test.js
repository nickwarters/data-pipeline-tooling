// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isolateBrowserGlobals } from './helpers/browser-globals.js';

isolateBrowserGlobals();

const { Router } = await import('../src/lib/router.js');
const { registerRoutes, safeRegister } =
  await import('../src/setup/register-routes.js');

/** @returns {import('../src/setup/register-routes.js').AppContext} */
function makeContext() {
  return /** @type {any} */ ({
    client: {},
    saveQueue: {},
    currentUser: { id: 'u1' },
    capabilities: {},
    caseSources: [],
    allCaseSources: [],
    journeyCaseSources: [],
    allocationSources: [],
    appEl: {
      classList: { add() {}, remove() {} },
      setAttribute() {},
      appendChild() {},
      replaceChildren() {},
    },
    loadQuestionBankEditor: () => Promise.resolve(),
  });
}

function registeredPatterns() {
  /** @type {string[]} */
  const patterns = [];
  const router = {
    register(/** @type {string} */ pattern) {
      patterns.push(pattern);
    },
  };
  registerRoutes(/** @type {any} */ (router), makeContext());
  return patterns;
}

test('safeRegister: a throwing registration function does not propagate and is logged', () => {
  const router = new Router();
  const context = makeContext();
  /** @type {any[]} */
  const errorCalls = [];
  const origConsoleError = console.error;
  console.error = (/** @type {any[]} */ ...args) => errorCalls.push(args);

  try {
    assert.doesNotThrow(() => {
      safeRegister(
        'boom-route',
        () => {
          throw new Error('registration boom');
        },
        router,
        context
      );
    });
    assert.equal(errorCalls.length, 1, 'the failure should be logged once');
    assert.ok(
      errorCalls[0].some(
        (/** @type {any} */ arg) =>
          typeof arg === 'string' && arg.includes('boom-route')
      ),
      'console.error should mention the failing route name'
    );
  } finally {
    console.error = origConsoleError;
  }
});

test('safeRegister: a succeeding registration function runs with router + context', () => {
  const router = new Router();
  const context = makeContext();
  /** @type {any[]} */
  const calls = [];

  safeRegister(
    'ok-route',
    (/** @type {any} */ r, /** @type {any} */ c) => {
      calls.push([r, c]);
    },
    router,
    context
  );

  assert.equal(calls.length, 1, 'the registration function should run once');
  assert.equal(calls[0][0], router, 'router is passed through');
  assert.equal(calls[0][1], context, 'context is passed through');
});

test('registerRoutes: registers the complete public route contract', () => {
  assert.deepEqual(registeredPatterns(), [
    '#/',
    '#/dashboard',
    '#/conversation/:caseType/:id',
    '#/conversation/:id',
    '#/question-bank',
    '#/case/:caseType/:id',
    '#/case/:id',
    '#/team-cases',
    '#/my-cases',
    '#/journey-cases',
    '#/roadmap',
    '#/my-team',
  ]);
});
