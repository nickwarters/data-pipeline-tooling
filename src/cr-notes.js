// @ts-check
import { CRElement } from './cr-element.js';

/** @typedef {import('./save-queue.js').SaveQueue} SaveQueue */

export class CRNotes extends CRElement {
  constructor() {
    super();
    /** @type {string} */
    this.notes = '';
    /** @type {SaveQueue | null} */
    this.saveQueue = null;
    /** @type {string} */
    this.caseId = '';
    /** @type {'edit'|'read-only'|'hidden'} */
    this.access = 'edit';
  }

  connectedCallback() {
    const heading = document.createElement('h2');
    heading.textContent = 'Notes';

    const textarea = /** @type {HTMLTextAreaElement} */ (/** @type {unknown} */ (document.createElement('textarea')));
    /** @type {any} */ (textarea).className = 'cr-notes-input';
    /** @type {any} */ (textarea).placeholder = 'Add notes…';
    /** @type {any} */ (textarea).value = this.notes;
    /** @type {any} */ (textarea).setAttribute?.('aria-label', 'Case notes');
    if (this.access === 'read-only') {
      /** @type {any} */ (textarea).readOnly = true;
      /** @type {any} */ (textarea).setAttribute?.('readonly', 'readonly');
    }

    textarea.addEventListener('input', (ev) => {
      if (this.access === 'read-only') return;
      if (!this.saveQueue || !this.caseId) return;
      const value = /** @type {any} */ (ev.target).value ?? '';
      this.saveQueue.enqueue(this.caseId, 'notes', value);
    });

    this.replaceChildren(
      /** @type {any} */ (heading),
      /** @type {any} */ (textarea)
    );
  }
}

customElements.define('cr-notes', CRNotes);
