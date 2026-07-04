// @ts-check
import { h } from '../../lib/html.js';
import {
  baselineBank,
  commit,
} from '../../question-bank/question-bank-store.js';

/**
 * @typedef {Object} WordingEditorProps
 * @property {any} question
 * @property {any} baselineQuestion
 * @property {(value: string) => void} onTextInput
 */

/**
 * @param {WordingEditorProps} props
 * @returns {HTMLElement | undefined}
 */
export function WordingEditor({ question, baselineQuestion, onTextInput }) {
  if (!question) return undefined;

  const wrap = h('div', { class: 'wording' });
  wrap.appendChild(h('span', { class: 'edit-mark' }, 'click to edit'));

  const textarea = /** @type {any} */ (
    h('textarea', {
      class: 'q-text' + (question.deprecated ? ' deprecated-text' : ''),
      rows: '1',
      'aria-label': 'Question wording',
      spellcheck: 'true',
      'data-focus-key': `wording:${question.id}`,
    })
  );
  textarea.value = question.text;

  const autoresize = () => {
    try {
      textarea.style.height = 'auto';
      textarea.style.height = textarea.scrollHeight + 2 + 'px';
    } catch {}
  };
  textarea.addEventListener('focus', () => {
    wrap.className = 'wording focused';
  });
  textarea.addEventListener('blur', () => {
    wrap.className = 'wording';
  });
  textarea.addEventListener('input', (/** @type {any} */ event) => {
    autoresize();
    onTextInput(event.target.value);
  });
  const raf = /** @type {any} */ (globalThis).requestAnimationFrame;
  if (typeof raf === 'function') raf(autoresize);
  wrap.appendChild(textarea);

  const status = wordingStatus(question, baselineQuestion);
  const length = question.text.length;
  const charCount = h(
    'span',
    { class: 'charcount' + (length > 180 ? ' warn' : '') },
    `${length} chars`
  );

  wrap.appendChild(h('div', { class: 'wording-foot' }, status, charCount));
  return wrap;
}

/**
 * @param {any} question
 * @param {any} baselineQuestion
 * @returns {HTMLElement}
 */
function wordingStatus(question, baselineQuestion) {
  if (!baselineQuestion) {
    return h('span', {}, h('span', { className: 'changed' }, '● New draft'));
  }
  if (baselineQuestion.text !== question.text) {
    return h(
      'span',
      {},
      h(
        'span',
        { className: 'changed' },
        `● Edited · was "${baselineQuestion.text.slice(0, 60)}${baselineQuestion.text.length > 60 ? '…' : ''}"`
      )
    );
  }
  return h('span', {}, '○ Unchanged');
}

export class CORAWordingEditor extends HTMLElement {
  constructor() {
    super();
    /** @type {any} */
    this.question = null;
  }

  connectedCallback() {
    this._render();
  }

  _render() {
    const content = this.render();
    if (content) this.replaceChildren(content);
    else this.replaceChildren();
  }

  render() {
    const baselineQuestion = (baselineBank.get()?.questions || []).find(
      (/** @type {any} */ candidate) => candidate.id === this.question?.id
    );

    return WordingEditor({
      question: this.question,
      baselineQuestion,
      onTextInput: (value) => {
        commit(() => {
          this.question.text = value;
        });
      },
    });
  }
}

customElements.define('cora-wording-editor', CORAWordingEditor);
