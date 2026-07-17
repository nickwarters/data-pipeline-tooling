// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import {
  freshExampleReviewBank,
  commitSpy,
} from './_example-review-fixture.js';
import { fireEvent, getByRole, getByText } from './helpers/semantic-dom.js';
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

  const textarea = getByRole(node, 'textbox', { name: 'Question wording' });
  assert.equal(textarea.value, 'Question text');
  assert.equal(getByText(node, '13 chars').textContent, '13 chars');
});

test('CORAWordingEditor: no question → renders nothing', () => {
  const e = new CORAWordingEditor();
  e.connectedCallback();
  assert.equal(e.childElementCount, 0);
});

test('CORAWordingEditor: renders edit mark, textarea, status pill, char count', () => {
  const q = freshExampleReviewBank().questions[0];
  const e = mount(q, structuredClone(q));
  const wrap = e.querySelector('.wording');
  assert.ok(wrap);
  assert.equal(wrap.className, 'wording');
  const txt = getByRole(wrap, 'textbox', { name: 'Question wording' });
  assert.equal(txt.value, q.text);
  assert.ok(getByText(wrap, /Unchanged/));
});

test('CORAWordingEditor: shows "Edited" when text diverges from baseline', () => {
  const baseline = freshExampleReviewBank().questions[0];
  const q = structuredClone(baseline);
  q.text = 'CHANGED';
  const e = mount(q, baseline);
  assert.ok(getByText(e, /Edited/));
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
  assert.ok(getByText(e, /New draft/));
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
  const cc = e.querySelector('.charcount');
  assert.ok(cc);
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
  const txt = getByRole(e, 'textbox', { name: 'Question wording' });
  assert.ok(txt.className.includes('deprecated-text'));
});

test('CORAWordingEditor: focus/blur toggle "focused" class; input commits via onCommit', () => {
  const q = freshExampleReviewBank().questions[0];
  const e = mount(q, structuredClone(q));
  const wrap = e.querySelector('.wording');
  assert.ok(wrap);
  const txt = getByRole(e, 'textbox', { name: 'Question wording' });
  fireEvent(txt, 'focus');
  assert.equal(wrap.className, 'wording focused');
  fireEvent(txt, 'blur');
  assert.equal(wrap.className, 'wording');
  // Input event commits the new text through the onCommit prop
  fireEvent(txt, 'input', { target: { value: 'new wording' } });
  assert.equal(q.text, 'new wording');
  assert.equal(/** @type {any} */ (e.onCommit).calls, 1);
});

test('CORAWordingEditor: long baseline text gets ellipsis', () => {
  const baseline = freshExampleReviewBank().questions[0];
  baseline.text = 'A'.repeat(100);
  const q = structuredClone(baseline);
  q.text = 'short';
  const e = mount(q, baseline);
  const status = getByText(e, /Edited/).textContent;
  assert.ok(status.includes('…'));
});
