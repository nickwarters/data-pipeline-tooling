// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';

installDom();

const { h } = await import('../src/lib/html.js');
const { createMemo } = await import('../src/core/memo.js');
const { morph } = await import('../src/core/morph.js');

function container() {
  return /** @type {any} */ (globalThis).document.createElement('div');
}

test('memo: unchanged deps return the same subtree and morph patches nothing', () => {
  const memo = createMemo();
  const root = container();
  let renders = 0;
  const card = () => {
    renders++;
    return h('article', { key: 'q1' }, h('p', {}, 'unchanged'));
  };

  const first = memo('q1', ['Yes', true], card);
  morph(root, first);
  const second = memo('q1', ['Yes', true], card);
  const stats = morph(root, second);

  assert.equal(second, first);
  assert.equal(renders, 1);
  assert.equal(stats.visited, 1);
  assert.equal(stats.patchedElements || 0, 0);
});

test('memo: a changed dependency rebuilds only its entry', () => {
  const memo = createMemo();
  const renders = { q1: 0, q2: 0 };
  const render = (/** @type {'q1' | 'q2'} */ key) => {
    renders[key]++;
    return { key, render: renders[key] };
  };

  const q1 = memo('q1', ['Yes'], () => render('q1'));
  const q2 = memo('q2', ['No'], () => render('q2'));
  const changedQ1 = memo('q1', ['No'], () => render('q1'));
  const stableQ2 = memo('q2', ['No'], () => render('q2'));

  assert.notEqual(changedQ1, q1);
  assert.equal(stableQ2, q2);
  assert.deepEqual(renders, { q1: 2, q2: 1 });
  assert.equal(memo.size, 2);
});

test('memo: showWhen fan-out rebuilds precisely the affected entries', () => {
  const memo = createMemo();
  const questions = ['always', 'conditional-1', 'conditional-2'];
  const renders = new Map(questions.map((key) => [key, 0]));
  const renderAll = (/** @type {string} */ gateAnswer) =>
    questions.map((key) => {
      const applicable = key === 'always' || gateAnswer === 'Yes';
      return memo(key, [applicable], () => {
        renders.set(key, /** @type {number} */ (renders.get(key)) + 1);
        return { key, applicable };
      });
    });

  const before = renderAll('No');
  const after = renderAll('Yes');

  assert.equal(after[0], before[0], 'unaffected sibling stays cached');
  assert.notEqual(after[1], before[1]);
  assert.notEqual(after[2], before[2]);
  assert.deepEqual(Object.fromEntries(renders), {
    always: 1,
    'conditional-1': 2,
    'conditional-2': 2,
  });
  assert.deepEqual(
    after.map((card) => card.applicable),
    [true, true, true]
  );
});

test('memo: Object.is dependency semantics handle NaN and distinguish zero signs', () => {
  const memo = createMemo();
  const nan = memo('key', [NaN], () => ({}));
  assert.equal(
    memo('key', [NaN], () => ({})),
    nan
  );
  assert.notEqual(
    memo('key', [-0], () => ({})),
    nan
  );
  const negativeZero = memo('key', [-0], () => ({}));
  assert.notEqual(
    memo('key', [0], () => ({})),
    negativeZero
  );
});

test('memo: changing dependency length rebuilds the entry', () => {
  const memo = createMemo();
  const first = memo('key', [1], () => ({}));
  assert.notEqual(
    memo('key', [1, 2], () => ({})),
    first
  );
});

test('memo: dependencies are snapshotted rather than retained by reference', () => {
  const memo = createMemo();
  const deps = ['before'];
  const first = memo('key', deps, () => ({}));
  deps[0] = 'after';
  assert.notEqual(
    memo('key', deps, () => ({})),
    first
  );
});

test('memo: delete evicts one entry and reports whether it existed', () => {
  const memo = createMemo();
  const first = memo('q1', [], () => ({}));
  memo('q2', [], () => ({}));
  assert.equal(memo.delete('missing'), false);
  assert.equal(memo.delete('q1'), true);
  assert.equal(memo.size, 1);
  assert.notEqual(
    memo('q1', [], () => ({})),
    first
  );
});

test('memo: clear on owner unmount releases every cached subtree', () => {
  const memo = createMemo();
  const first = memo('q1', [], () => ({}));
  memo('q2', [], () => ({}));
  assert.equal(memo.size, 2);

  memo.clear();

  assert.equal(memo.size, 0);
  assert.notEqual(
    memo('q1', [], () => ({})),
    first
  );
});
