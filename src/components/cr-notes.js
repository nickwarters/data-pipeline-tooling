// @ts-check
import { ReactiveElement } from './reactive-element.js';
import { h } from '../lib/html.js';

/** @typedef {import('../services/save-queue.js').SaveQueue} SaveQueue */

export class CRNotes extends ReactiveElement {
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

  render() {
    return [
      h('h2', {}, 'Notes'),
      ...this._buildBox({
        label: 'Case notes',
        className: 'cr-notes-input',
        placeholder: 'Add notes…',
        value: this.notes,
        fieldName: 'notes',
      }),
      ...this._buildBox({
        label: 'Case Justification',
        className: 'cr-case-justification-input',
        placeholder: 'Add Case Justification…',
        value: this.caseJustification,
        fieldName: 'caseJustification',
      }),
    ];
  }

  /**
   * Build a labelled textarea bound to a single Case-row field. The textarea
   * autosaves through the SaveQueue (field-level PATCH) and honours the Notes
   * Section access mode.
   * @param {{ label: string, className: string, placeholder: string, value: string, fieldName: string }} opts
   * @returns {Node[]}
   */
  _buildBox({ label, className, placeholder, value, fieldName }) {
    const isReadOnly = this.access === 'read-only';

    return [
      h('label', {}, label),
      h('textarea', {
        className,
        placeholder,
        value,
        'aria-label': label,
        readOnly: isReadOnly ? true : undefined,
        readonly: isReadOnly ? 'readonly' : undefined,
        oninput: (ev) => {
          if (this.access === 'read-only') return;
          if (!this.saveQueue || !this.caseId) return;
          const val = /** @type {any} */ (ev.target).value ?? '';
          this.saveQueue.enqueue(this.caseId, fieldName, val);
        }
      })
    ];
  }
}

customElements.define('cr-notes', CRNotes);
