// @ts-check
import { ShellElement } from '../lib/view.js';
import { h } from '../lib/html.js';

/** @typedef {import('../services/save-queue.js').SaveQueue} SaveQueue */

/**
 * @typedef {object} NotesProps
 * @property {string} notes
 * @property {string} caseJustification
 * @property {SaveQueue | null} saveQueue
 * @property {string} caseId
 * @property {'edit'|'read-only'|'hidden'} access
 */

/**
 * @param {NotesProps} props
 * @returns {Node[]}
 */
export function Notes(props) {
  return [
    h('h2', {}, 'Notes'),
    ...notesBox({
      label: 'Case notes',
      className: 'cr-notes-input',
      placeholder: 'Add notes…',
      value: props.notes,
      fieldName: 'notes',
      props,
    }),
    ...notesBox({
      label: 'Case Justification',
      className: 'cr-case-justification-input',
      placeholder: 'Add Case Justification…',
      value: props.caseJustification,
      fieldName: 'caseJustification',
      props,
    }),
  ];
}

/**
 * Build a labelled textarea bound to a single Case-row field. The textarea
 * autosaves through the SaveQueue (field-level PATCH) and honours the Notes
 * Section access mode.
 * @param {{ label: string, className: string, placeholder: string, value: string, fieldName: string, props: NotesProps }} opts
 * @returns {Node[]}
 */
export function notesBox({
  label,
  className,
  placeholder,
  value,
  fieldName,
  props,
}) {
  const isReadOnly = props.access === 'read-only';

  return [
    h('label', {}, label),
    h('textarea', {
      className,
      placeholder,
      value,
      'aria-label': label,
      readOnly: isReadOnly ? true : undefined,
      readonly: isReadOnly ? 'readonly' : undefined,
      oninput: (/** @type {Event} */ ev) => {
        if (props.access === 'read-only') return;
        if (!props.saveQueue || !props.caseId) return;
        const val = /** @type {any} */ (ev.target).value ?? '';
        props.saveQueue.enqueue(props.caseId, fieldName, val);
      },
    }),
  ];
}

export class CRNotes extends ShellElement {
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
    return Notes({
      notes: this.notes,
      caseJustification: this.caseJustification,
      saveQueue: this.saveQueue,
      caseId: this.caseId,
      access: this.access,
    });
  }
}

customElements.define('cr-notes', CRNotes);
