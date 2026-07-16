// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import {
  freshExampleReviewBank,
  commitSpy,
} from './_example-review-fixture.js';
installDom();

const { CORAWordingEditor, WordingEditor } =
  await import('../src/components/sections/cora-wording-editor.js');

/**
 * Mount a CORAWordingEditor with props and an onCommit spy (no store).
 * @param {any} q @param {any} [baselineQuestion]
 */
function mount(q, baselineQuestion) {
  const e = new CORAWordingEditor();
  e.question = q;
  e.baselineQuestion = baselineQuestion;
  e.onCommit = commitSpy();
  e.connectedCallback();
  return e;
}

test('WordingEditor: plain function renders nothing without a question', () => {
  assert.equal(
    WordingEditor({
      question: null,
      baselineQuestion: null,
      onTextInput: () => {},
    }),
    undefined
  );
});

test('WordingEditor: plain function renders textarea and char count', () => {
  const node = WordingEditor({
    question: {
      id: 'q1',
      text: 'Question text',
      responseType: 'yes-no-na',
      deprecated: false,
    },
    baselineQuestion: {
      id: 'q1',
      text: 'Question text',
    },
    onTextInput: () => {},
  });

  const textarea = /** @type {any} */ (node)._children[1];
  const foot = /** @type {any} */ (node)._children[2];
  assert.equal(textarea.value, 'Question text');
  assert.equal(foot._children[1].textContent, '13 chars');
});

test('CORAWordingEditor: no question → renders nothing', () => {
  const e = new CORAWordingEditor();
  e.connectedCallback();
  assert.equal(/** @type {any} */ (e)._children.length, 0);
});

test('CORAWordingEditor: renders edit mark, textarea, status pill, char count', () => {
  const q = freshExampleReviewBank().questions[0];
  const e = mount(q, structuredClone(q));
  const wrap = /** @type {any} */ (e)._children[0];
  assert.equal(wrap.className, 'wording');
  // edit-mark span, textarea, wording-foot
  assert.equal(wrap._children.length, 3);
  const txt = wrap._children[1];
  assert.equal(txt.value, q.text);
  const foot = wrap._children[2];
  assert.ok(foot._children[0].textContent.includes('Unchanged'));
});

test('CORAWordingEditor: shows "Edited" when text diverges from baseline', () => {
  const baseline = freshExampleReviewBank().questions[0];
  const q = structuredClone(baseline);
  q.text = 'CHANGED';
  const e = mount(q, baseline);
  const wrap = /** @type {any} */ (e)._children[0];
  const foot = wrap._children[2];
  assert.ok(foot._children[0]._children[0].textContent.includes('Edited'));
});

test('CORAWordingEditor: shows "New draft" when no baseline match', () => {
  /** @type {any} */
  const q = {
    id: 'q-never-baseline',
    text: 'New',
    responseType: 'yes-no-na',
    deprecated: false,
  };
  const e = mount(q, undefined);
  const wrap = /** @type {any} */ (e)._children[0];
  const foot = wrap._children[2];
  assert.ok(foot._children[0]._children[0].textContent.includes('New draft'));
});

test('CORAWordingEditor: char count warns over 180', () => {
  /** @type {any} */
  const q = {
    id: 'q-long',
    text: 'x'.repeat(200),
    responseType: 'yes-no-na',
    deprecated: false,
  };
  const e = mount(q, undefined);
  const wrap = /** @type {any} */ (e)._children[0];
  const foot = wrap._children[2];
  const cc = foot._children[1];
  assert.equal(cc.className, 'charcount warn');
});

test('CORAWordingEditor: deprecated question adds deprecated-text class', () => {
  /** @type {any} */
  const q = {
    id: 'q-d',
    text: 'old',
    responseType: 'yes-no-na',
    deprecated: true,
  };
  const e = mount(q, undefined);
  const wrap = /** @type {any} */ (e)._children[0];
  const txt = wrap._children[1];
  assert.ok(txt.className.includes('deprecated-text'));
});

test('CORAWordingEditor: focus/blur toggle "focused" class; input commits via onCommit', () => {
  const q = freshExampleReviewBank().questions[0];
  const e = mount(q, structuredClone(q));
  const wrap = /** @type {any} */ (e)._children[0];
  const txt = wrap._children[1];
  txt._listeners.focus[0]();
  assert.equal(wrap.className, 'wording focused');
  txt._listeners.blur[0]();
  assert.equal(wrap.className, 'wording');
  // Input event commits the new text through the onCommit prop
  txt._listeners.input[0]({ target: { value: 'new wording' } });
  assert.equal(q.text, 'new wording');
  assert.equal(/** @type {any} */ (e.onCommit).calls, 1);
});

test('CORAWordingEditor: long baseline text gets ellipsis', () => {
  const baseline = freshExampleReviewBank().questions[0];
  baseline.text = 'A'.repeat(100);
  const q = structuredClone(baseline);
  q.text = 'short';
  const e = mount(q, baseline);
  const wrap = /** @type {any} */ (e)._children[0];
  const foot = wrap._children[2];
  const status = foot._children[0]._children[0].textContent;
  assert.ok(status.includes('…'));
});
