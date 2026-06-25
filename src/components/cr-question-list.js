// @ts-check
import { ReactiveElement } from './reactive-element.js';
import { h } from '../lib/html.js';
import './cr-question.js';

/** @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../sharepoint-client.js').Answer} Answer */

export class CRQuestionList extends ReactiveElement {
  constructor() {
    super();
    /** @type {QuestionDefinition[]} */
    this.questions = [];
    /** @type {Record<string, Answer>} */
    this.answers = {};
    /** @type {Set<string>} */
    this._renderedIds = new Set();
    /** @type {'edit'|'read-only'|'hidden'} */
    this.access = 'edit';
    /**
     * Rendered cr-question elements in display order. Exposed so siblings
     * (e.g. cr-case-review's "Jump to next unanswered" handler) can locate
     * a question's host element without reaching into the (browser-only,
     * not-on-our-test-stub) `children` HTMLCollection.
     * @type {import('./cr-question.js').CRQuestion[]}
     */
    this.questionElements = [];
  }

  /**
   * Replace the displayed questions and their current answer state.
   * Focus management: when an update introduces a previously-unseen question
   * (a conditional follow-up that just became applicable), focus that
   * question's host so keyboard users can continue answering without hunting.
   * @param {QuestionDefinition[]} questions
   * @param {Record<string, Answer>} answers
   */
  update(questions, answers) {
    const previous = this._renderedIds;
    /** @type {number} */
    let firstNewIndex = -1;
    questions.forEach((q, i) => {
      if (firstNewIndex === -1 && !previous.has(q.id)) firstNewIndex = i;
    });

    // Capture the user's focus *before* re-rendering. Answering a question can
    // re-evaluate applicability, which rebuilds the list via replaceChildren and
    // detaches (blurring) the focused input. Without this, keyboard users get
    // stranded at the top of the list and have to tab all the way back.
    const restoreFocus = this._captureFocus();

    this.questions = questions;
    this.answers = answers;
    this._render();

    // Priority 1: a genuinely new question appeared (a conditional follow-up
    // that just became applicable) — move focus to it so the user can continue
    // answering without hunting. Not on first render.
    if (previous.size > 0 && firstNewIndex !== -1) {
      const child = this.questionElements[firstNewIndex];
      child?.focus?.();
      return;
    }

    // Priority 2: nothing new appeared, but the DOM may have been rebuilt (e.g.
    // a downstream question disappeared). Put the user back where they were.
    restoreFocus();
  }

  /**
   * Snapshot the currently-focused answer input (identified by its stable
   * `data-focus-key`) and return a closure that re-focuses the matching input
   * after the list has re-rendered. Mirrors the focus-preservation in
   * question-bank-store's `commit()`. No-op when nothing relevant is focused
   * or when the same element still holds focus after rendering.
   * @returns {() => void}
   */
  _captureFocus() {
    const doc = typeof document !== 'undefined' ? document : null;
    const active = doc && doc.activeElement;
    const focusKey = active?.getAttribute?.('data-focus-key') ?? null;
    if (!focusKey) return () => {};

    return () => {
      const found = this.querySelector(
        `[data-focus-key="${focusKey.replace(/(["\\])/g, '\\$1')}"]`
      );
      if (found && found !== doc.activeElement) found.focus?.();
    };
  }

  _render() {
    const oldElements = this.questionElements ? [...this.questionElements] : [];
    const els = this.render();

    let changed = oldElements.length !== els.length;
    if (!changed) {
      for (let i = 0; i < els.length; i++) {
        if (oldElements[i] !== els[i]) {
          changed = true;
          break;
        }
      }
    }

    if (changed || els.length === 0) {
      if (Array.isArray(els)) this.replaceChildren(...els);
      else if (els) this.replaceChildren(els);
      else this.replaceChildren();
    }
  }

  render() {
    const existingElements = new Map();
    if (this.questionElements) {
      for (const el of this.questionElements) {
        if (el.question && el.question.id) {
          existingElements.set(el.question.id, el);
        }
      }
    }

    const elements = this.questions.map((q) => {
      const v = this.answers[q.id]?.value;
      const currentValue = v ?? (q.responseType === 'multi-choice' ? [] : '');

      const existing = existingElements.get(q.id);
      if (existing) {
        existing.question = q;
        existing.access = this.access;
        existing.currentValue = currentValue;
        return existing;
      }

      const el = /** @type {import('./cr-question.js').CRQuestion} */ (
        h('cr-question', {
          tabIndex: -1,
          question: q,
          access: this.access,
          currentValue,
        })
      );
      return el;
    });
    this.questionElements = elements;
    this._renderedIds = new Set(this.questions.map((q) => q.id));
    return elements;
  }
}

customElements.define('cr-question-list', CRQuestionList);
