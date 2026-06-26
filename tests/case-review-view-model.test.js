// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CaseReviewViewModel } from '../src/lib/case-review-view-model.js';
import { signal, effect } from '../src/lib/signal.js';

/**
 * Builds a view model wired just enough to exercise handleCapture: an editable
 * machine, a one-field capture group, and a stubbed save queue.
 * @param {(...args: any[]) => void} enqueue
 */
function makeVM(enqueue) {
  const vm = new CaseReviewViewModel(
    /** @type {any} */ ({}),
    /** @type {any} */ ({ enqueue }),
    'c1',
    'u1',
    null
  );
  vm.machine = /** @type {any} */ ({ canCapture: true });
  vm.config = /** @type {any} */ ({
    captureGroups: [
      { key: 'cause', fields: [{ key: 'rootCause', type: 'text' }] },
    ],
  });
  vm.answersSignal = signal(/** @type {any} */ ({ q1: { value: 'No' } }));
  return vm;
}

test('handleCapture restores window scroll after the re-render shifts it', () => {
  let scrollY = 500;
  /** @type {any} */ (globalThis).window = {
    scrollX: 0,
    get scrollY() {
      return scrollY;
    },
    scrollTo(/** @type {number} */ _x, /** @type {number} */ y) {
      scrollY = y;
    },
  };
  try {
    /** @type {any[]} */
    const calls = [];
    const vm = makeVM((...a) => calls.push(a));

    // Simulate the Issues re-render: any answers change "jumps" the scroll, as a
    // real DOM teardown above the viewport would.
    let first = true;
    effect(() => {
      vm.answersSignal.get();
      if (!first) scrollY = 0;
      first = false;
    });

    vm.handleCapture('q1', 'rootCause', 'Agent rushed');

    assert.equal(scrollY, 500, 'scroll position restored after the jump');
    assert.equal(calls.length, 1, 'still enqueues the save');
    assert.deepEqual(calls[0][2].q1.capture, { rootCause: 'Agent rushed' });
  } finally {
    delete (/** @type {any} */ (globalThis).window);
  }
});

test('handleCapture works (no throw) when window is absent', () => {
  assert.equal(typeof globalThis.window, 'undefined');
  /** @type {any[]} */
  const calls = [];
  const vm = makeVM((...a) => calls.push(a));
  vm.handleCapture('q1', 'rootCause', 'x');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][2].q1.capture, { rootCause: 'x' });
});
