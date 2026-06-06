// @ts-check
import { CRElement } from './cr-element.js';

/** @typedef {import('../services/save-queue.js').SaveQueue} SaveQueue */

export class CRNotes extends CRElement {
  constructor() {
    super();
    /** @type {string} */
    this.notes = '';
    /** @type {string} */
    this.caseJustification = '';
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

    // The Notes Section holds two fixed, case-level free-text boxes (issue #122):
    // the general note and the Case Justification. Both are plain-text fields on
    // the Case row (ADR-0007) and autosave independently via the SaveQueue.
    const note = this._buildBox({
      label: 'Case notes',
      className: 'cr-notes-input',
      placeholder: 'Add notes…',
      value: this.notes,
      fieldName: 'notes',
    });

    const justification = this._buildBox({
      label: 'Case Justification',
      className: 'cr-case-justification-input',
      placeholder: 'Add Case Justification…',
      value: this.caseJustification,
      fieldName: 'caseJustification',
    });

    this.replaceChildren(
      /** @type {any} */ (heading),
      ...note,
      ...justification
    );
  }

  /**
   * Build a labelled textarea bound to a single Case-row field. The textarea
   * autosaves through the SaveQueue (field-level PATCH) and honours the Notes
   * Section access mode.
   * @param {{ label: string, className: string, placeholder: string, value: string, fieldName: string }} opts
   * @returns {Node[]}
   */
  _buildBox({ label, className, placeholder, value, fieldName }) {
    const labelEl = document.createElement('label');
    labelEl.textContent = label;

    const textarea = /** @type {HTMLTextAreaElement} */ (/** @type {unknown} */ (document.createElement('textarea')));
    /** @type {any} */ (textarea).className = className;
    /** @type {any} */ (textarea).placeholder = placeholder;
    /** @type {any} */ (textarea).value = value;
    /** @type {any} */ (textarea).setAttribute('aria-label', label);
    if (this.access === 'read-only') {
      /** @type {any} */ (textarea).readOnly = true;
      /** @type {any} */ (textarea).setAttribute('readonly', 'readonly');
    }

    textarea.addEventListener('input', (ev) => {
      if (this.access === 'read-only') return;
      if (!this.saveQueue || !this.caseId) return;
      const value = /** @type {any} */ (ev.target).value ?? '';
      this.saveQueue.enqueue(this.caseId, fieldName, value);
    });

    return [/** @type {any} */ (labelEl), /** @type {any} */ (textarea)];
  }
}

customElements.define('cr-notes', CRNotes);
