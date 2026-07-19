// @ts-check
import { h } from '../../lib/html.js';

/**
 * @param {{
 *   notes: string,
 *   caseJustification: string,
 *   access: 'edit'|'read-only'|'hidden',
 *   heading: string,
 *   placeholders: import('../../sharepoint-client.js').Placeholders,
 *   onFieldInput: (field: 'notes'|'caseJustification', value: string) => void,
 * }} props
 */
export function notesView(props) {
  return h(
    'section',
    { className: 'cora-notes' },
    h('h2', {}, props.heading),
    notesField({
      label: 'Case notes',
      className: 'cora-notes-input',
      placeholder: props.placeholders.notes ?? 'Add notes…',
      value: props.notes,
      field: 'notes',
      ...props,
    }),
    notesField({
      label: 'Case Justification',
      className: 'cora-case-justification-input',
      placeholder:
        props.placeholders.caseJustification ?? 'Add Case Justification…',
      value: props.caseJustification,
      field: 'caseJustification',
      ...props,
    })
  );
}

/**
 * @param {{
 *   label: string,
 *   className: string,
 *   placeholder: string,
 *   value: string,
 *   field: 'notes'|'caseJustification',
 *   access: 'edit'|'read-only'|'hidden',
 *   onFieldInput: (field: 'notes'|'caseJustification', value: string) => void,
 * }} props
 */
function notesField(props) {
  const readOnly = props.access !== 'edit';
  return h(
    'label',
    {},
    h('span', {}, props.label),
    h('textarea', {
      className: props.className,
      placeholder: props.placeholder,
      value: props.value,
      'aria-label': props.label,
      readOnly,
      readonly: readOnly ? 'readonly' : undefined,
      onInput: (/** @type {any} */ event) => {
        if (readOnly) return;
        props.onFieldInput(props.field, event.target.value ?? '');
      },
    })
  );
}
