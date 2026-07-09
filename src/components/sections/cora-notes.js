// @ts-check
import { ShellElement } from '../../lib/view.js';
import { h } from '../../lib/html.js';

/** @typedef {import('../../services/save-queue.js').SaveQueue} SaveQueue */
/** @typedef {import('../../sharepoint-client.js').CaseRow} CaseRow */

/**
 * @typedef {object} NotesProps
 * @property {string} notes
 * @property {string} caseJustification
 * @property {SaveQueue | null} saveQueue
 * @property {string} caseId
 * @property {'edit'|'read-only'|'hidden'} access
 * @property {CaseRow | null} [caseRow]
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
      className: 'cora-notes-input',
      placeholder: 'Add notes…',
      value: props.notes,
      fieldName: 'notes',
      props,
    }),
    ...notesBox({
      label: 'Case Justification',
      className: 'cora-case-justification-input',
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
 *
 * On input it mirrors the typed value back onto the `caseRow` (the single
 * source of truth this Section renders from, mirroring `cora-appeal`) *as well
 * as* enqueuing the field-level PATCH. Without the in-memory write-back, a
 * re-render — e.g. a tab switch reconnecting the element, or the case-review
 * shell repainting on any signal change — would repaint the textarea from the
 * last saved/loaded value and discard uncommitted input. Autosave
 * semantics are unchanged: still a debounced, ETag-guarded PATCH.
 * @param {{ label: string, className: string, placeholder: string, value: string, fieldName: 'notes' | 'caseJustification', props: NotesProps }} opts
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
        const val = /** @type {any} */ (ev.target).value ?? '';
        if (props.caseRow) props.caseRow[fieldName] = val;
        if (!props.saveQueue || !props.caseId) return;
        props.saveQueue.enqueue(props.caseId, fieldName, val);
      },
    }),
  ];
}

export class CORANotes extends ShellElement {
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
    /**
     * The Case row this Section renders from and writes edits back onto — the
     * single source of truth. When absent, rendering falls back to
     * the `notes` / `caseJustification` string props.
     * @type {CaseRow | null}
     */
    this.caseRow = null;
  }

  render() {
    const caseRow = this.caseRow;
    return Notes({
      notes: caseRow ? caseRow.notes : this.notes,
      caseJustification: caseRow
        ? (caseRow.caseJustification ?? '')
        : this.caseJustification,
      saveQueue: this.saveQueue,
      caseId: this.caseId,
      access: this.access,
      caseRow,
    });
  }
}

customElements.define('cora-notes', CORANotes);
