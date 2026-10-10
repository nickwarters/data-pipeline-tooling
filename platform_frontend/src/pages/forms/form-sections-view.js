// @ts-check
/**
 * The one renderer every Form Type is drawn by: it walks a definition's
 * sections, panels and fields and draws each field as a control or as text.
 *
 * The mode decides the page, and the access rule decides each field. In `edit`
 * a field the viewer may change is a control and every other field is text in
 * the same place; in `view` and `locked` every field is text. There is no
 * disabled input anywhere: a value someone cannot change reads as what it is.
 *
 * Each control comes from the capture-field registry, the same vocabulary a
 * Case's Issue Capture Fields use, so a `date` or a `person` behaves alike in
 * both places.
 */

import { h } from '../../lib/html.js';
import { formatDate } from '../../lib/format-datetime.js';
import { getCaptureFieldType } from '../../capture-fields/registry.js';
import {
  captureDisplayText,
  isEmptyCaptureValue,
  isPerson,
} from '../../evaluators/capture-values.js';
import { MANAGER_RECORDS } from '../../../form-types/contract.js';
import { editsWhileOpen, namesAccount } from '../../services/form-access.js';
import { formActionsEditor } from './form-actions-view.js';

/** @typedef {import('../../sharepoint-client.js').FormItem} FormItem */
/** @typedef {import('../../sharepoint-client.js').FormValue} FormValue */
/** @typedef {import('../../sharepoint-client.js').FormAction} FormAction */
/** @typedef {import('../../services/form-access.js').FormAccess} FormAccess */
/** @typedef {import('../../lib/people-search.js').PeopleSearchState} PeopleSearchState */
/** @typedef {import('../../../form-types/contract.js').FormTypeDefinition} FormTypeDefinition */
/** @typedef {import('../../../form-types/contract.js').FormField} FormField */
/** @typedef {import('../../../form-types/contract.js').FormSection} FormSection */

/**
 * `edit` while the viewer may change the Form, `view` when they may only read
 * it, and `locked` once it has closed, for everyone.
 *
 * @typedef {'edit' | 'view' | 'locked'} FormMode
 */

/**
 * @typedef {Object} FormSectionsContext
 * @property {FormMode} mode
 * @property {FormAccess} access
 * @property {string} me The viewer's account.
 * @property {Record<string, PeopleSearchState>} peopleSearch Keyed by column.
 * @property {(itemField: string, value: FormValue) => void} onField
 * @property {(itemField: string, query: string) => void} onPersonQuery
 * @property {number | null} removingAction The Form Action whose removal
 *   awaits a yes.
 * @property {(itemField: string, actions: FormAction[]) => void} onActions
 *   Every change to the Form Actions, as the whole new list.
 * @property {(index: number) => void} onRemoveAction
 * @property {() => void} onRemoveWithdrawn
 */

/** What an empty field reads as, wherever it is shown as text. */
export const NOTHING_RECORDED = 'Nothing recorded';

/**
 * @param {FormAccess} access
 * @returns {FormMode}
 */
export function formMode(access) {
  if (access.locked) return 'locked';
  return access.canEdit ? 'edit' : 'view';
}

/**
 * Every section of the Form, in the definition's order.
 *
 * @param {FormTypeDefinition} definition
 * @param {FormItem} item
 * @param {FormSectionsContext} context
 * @returns {Node[]}
 */
export function formSectionsView(definition, item, context) {
  return definition.sections.flatMap((section, index) =>
    sectionView(section, `form-section-${index}`, item, context)
  );
}

/**
 * @param {FormSection} section
 * @param {string} id
 * @param {FormItem} item
 * @param {FormSectionsContext} context
 * @returns {Node[]}
 */
function sectionView(section, id, item, context) {
  if (section.sectionType === 'actions') {
    return [actionsView(section, id, item, context)];
  }
  if (section.sectionType === 'split-panel') {
    return [
      h(
        'div',
        { className: 'cora-form-split' },
        ...section.panels.map((panel, index) =>
          panelView(
            {
              panelName: panel.panelName,
              hint: panel.hint,
              fields: panel.fields,
              layout: 'stacked',
            },
            `${id}-${index}`,
            item,
            context
          )
        )
      ),
    ];
  }
  const layout = section.layout ?? 'stacked';
  if (layout !== 'strip') {
    return [panelView({ ...section, layout }, id, item, context)];
  }
  const strip = h(
    'section',
    { className: 'cora-form-strip', 'aria-label': section.panelName },
    ...section.fields.map((field) => stripCellView(field, item, context))
  );
  const recorded =
    context.mode === 'locked' ? recordedAtCloseView(section, item) : null;
  return recorded ? [strip, recorded] : [strip];
}

/**
 * A panel with a heading, laid out `question-answer` or `stacked`.
 *
 * @param {{ panelName: string, hint?: string, fields: readonly FormField[], layout: 'question-answer' | 'stacked' }} panel
 * @param {string} id
 * @param {FormItem} item
 * @param {FormSectionsContext} context
 */
function panelView(panel, id, item, context) {
  const headingId = `${id}-heading`;
  const owner =
    panel.fields.length === 1
      ? ownerNote(panel.fields[0], item, context)
      : null;
  return h(
    'section',
    {
      className: `cora-form-panel cora-form-panel--${panel.layout}`,
      'aria-labelledby': headingId,
    },
    h(
      'header',
      { className: 'cora-form-panel-header' },
      h('h2', { id: headingId }, panel.panelName),
      panel.hint
        ? h('p', { className: 'cora-form-panel-hint' }, panel.hint)
        : null,
      owner ? h('p', { className: 'cora-form-panel-hint' }, owner) : null
    ),
    ...panel.fields.map((field) =>
      panel.layout === 'question-answer'
        ? questionAnswerRowView(field, item, context)
        : stackedFieldView(field, item, context)
    )
  );
}

/**
 * One label and value pair in a strip. A manager the Form records also says
 * who has that role now, since only the current manager has access.
 *
 * @param {FormField} field
 * @param {FormItem} item
 * @param {FormSectionsContext} context
 */
function stripCellView(field, item, context) {
  const currentColumn = MANAGER_RECORDS[field.itemField];
  // A closed Form's record is frozen and shown apart from the strip, so the
  // strip says who has access to it now.
  if (currentColumn && context.mode === 'locked') {
    return h(
      'div',
      { className: 'cora-form-strip-cell' },
      h(
        'span',
        { className: 'cora-form-strip-label' },
        `Current ${lowerFirst(field.label)}`
      ),
      readOnlyValue(field, item.fields[currentColumn])
    );
  }
  const caption = currentColumn
    ? currentManagerNote(item, field.itemField, currentColumn, context.me)
    : null;
  return h(
    'div',
    { className: 'cora-form-strip-cell' },
    fieldCaptioned(field, item, context, 'cora-form-strip-label'),
    caption ? h('span', { className: 'cora-form-strip-note' }, caption) : null
  );
}

/**
 * @param {FormField} field
 * @param {FormItem} item
 * @param {FormSectionsContext} context
 */
function questionAnswerRowView(field, item, context) {
  // The question sits apart from its answer, so it names the control by id
  // rather than by wrapping it.
  const labelId = `form-${field.itemField}-label`;
  const hintId = `form-${field.itemField}-hint`;
  return h(
    'div',
    { className: 'cora-form-qa-row' },
    h(
      'div',
      { className: 'cora-form-qa-question' },
      h('span', { className: 'cora-form-label', id: labelId }, field.label),
      field.hint
        ? h('span', { className: 'cora-form-hint', id: hintId }, field.hint)
        : null
    ),
    h(
      'div',
      { className: 'cora-form-qa-answer' },
      isEditable(field, context)
        ? namedBy(
            controlView(field, item, context),
            labelId,
            field.hint ? hintId : null
          )
        : readOnlyValue(field, item.fields[field.itemField])
    )
  );
}

/**
 * Point a control at the caption and hint that name it from elsewhere on the
 * page. A set of radio buttons is named as a group. A person picker names its
 * own search box, so it is left as it is.
 *
 * @param {HTMLElement} control
 * @param {string} labelId
 * @param {string | null} hintId
 */
function namedBy(control, labelId, hintId) {
  if (control.className === 'cora-capture-radio-group') {
    control.setAttribute('role', 'radiogroup');
  } else if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(control.tagName)) {
    return control;
  }
  control.setAttribute('aria-labelledby', labelId);
  if (hintId) control.setAttribute('aria-describedby', hintId);
  return control;
}

/**
 * @param {FormField} field
 * @param {FormItem} item
 * @param {FormSectionsContext} context
 */
function stackedFieldView(field, item, context) {
  return h(
    'div',
    { className: 'cora-form-field' },
    fieldCaptioned(field, item, context, 'cora-form-label'),
    field.hint ? h('span', { className: 'cora-form-hint' }, field.hint) : null
  );
}

/**
 * A field's caption and its control or value, associated the way its control
 * type asks: a label around a single control, or a caption beside one that
 * names its own parts.
 *
 * @param {FormField} field
 * @param {FormItem} item
 * @param {FormSectionsContext} context
 * @param {string} captionClass
 */
function fieldCaptioned(field, item, context, captionClass) {
  const className = field.hideLabel
    ? `${captionClass} cora-form-visually-hidden`
    : captionClass;
  const caption = h(
    'span',
    { className },
    field.label,
    field.optional && isEditable(field, context)
      ? h('span', { className: 'cora-form-optional' }, ' (optional)')
      : null
  );
  if (!isEditable(field, context)) {
    return h(
      'div',
      { className: 'cora-form-value-group' },
      caption,
      readOnlyValue(field, item.fields[field.itemField])
    );
  }
  const control = controlView(field, item, context);
  const style = getCaptureFieldType(field.type)?.caption ?? 'wraps';
  if (style === 'wraps') {
    return h(
      'label',
      { className: 'cora-form-control-group' },
      caption,
      control
    );
  }
  if (style === 'legend') {
    return h(
      'fieldset',
      { className: 'cora-form-control-group' },
      h('legend', { className }, field.label),
      control
    );
  }
  return h('div', { className: 'cora-form-control-group' }, caption, control);
}

/**
 * The control a field is edited with, from the capture-field registry. Each
 * names itself: a textual control is wrapped by its caption, and a person
 * picker carries its own accessible name.
 *
 * @param {FormField} field
 * @param {FormItem} item
 * @param {FormSectionsContext} context
 */
function controlView(field, item, context) {
  const type = getCaptureFieldType(field.type);
  // The gate refuses a type the registry cannot draw; one that slips past is
  // shown as what is stored rather than taking the page down.
  if (!type) return readOnlyValue(field, item.fields[field.itemField]);
  return type.editControl({
    field: {
      key: field.itemField,
      label: field.label,
      type: /** @type {any} */ (field.type),
      options: field.choices ? [...field.choices] : undefined,
      placeholder: field.placeholder,
    },
    value: item.fields[field.itemField],
    namePrefix: 'form-',
    onCapture: (itemField, value) =>
      context.onField(itemField, /** @type {FormValue} */ (value)),
    peopleSearch: context.peopleSearch,
    onPersonQuery: context.onPersonQuery,
  });
}

/**
 * A value as text, or "Nothing recorded".
 *
 * @param {FormField} field
 * @param {unknown} value
 */
function readOnlyValue(field, value) {
  if (isEmptyCaptureValue(value)) {
    return h(
      'span',
      { className: 'cora-form-value cora-form-empty' },
      NOTHING_RECORDED
    );
  }
  const text =
    field.type === 'date' ? formatDate(value) : captureDisplayText(value);
  return h(
    'span',
    {
      className:
        field.type === 'textarea'
          ? 'cora-form-value cora-form-value--long'
          : 'cora-form-value',
    },
    text
  );
}

/**
 * @param {FormField} field
 * @param {FormSectionsContext} context
 */
function isEditable(field, context) {
  return context.mode === 'edit' && context.access.canEditField(field);
}

/**
 * Who may write in a panel holding one field that only one editor owns, said
 * where the panel's heading is, so the other editor is not left wondering why
 * the box is text.
 *
 * @param {FormField} field
 * @param {FormItem} item
 * @param {FormSectionsContext} context
 * @returns {string | null}
 */
function ownerNote(field, item, context) {
  if (!field.editableBy || context.mode !== 'edit') return null;
  if (context.access.canEditField(field)) return 'You';
  const owner =
    field.editableBy === 'employee'
      ? item.fields.Employee
      : item.fields.CurrentFirstLineManager;
  return isPerson(owner) ? `Only ${owner.displayName} can write here` : null;
}

/**
 * What the current holder of a recorded manager role may do: "You" for the
 * viewer, otherwise whether they edit or only read. When the record names
 * someone else, it is the current manager who has access, so they are named.
 *
 * @param {FormItem} item
 * @param {string} recordColumn
 * @param {string} currentColumn
 * @param {string} me
 * @returns {string | null}
 */
function currentManagerNote(item, recordColumn, currentColumn, me) {
  const current = item.fields[currentColumn];
  if (!isPerson(current)) return null;
  const recorded = item.fields[recordColumn];
  const isMe = namesAccount(current, me);
  if (isPerson(recorded) && namesAccount(current, recorded.loginName)) {
    if (isMe) return 'You';
    return editsWhileOpen(item, current.loginName) ? 'Can edit' : 'View only';
  }
  return `Has access now: ${current.displayName}${isMe ? ' (you)' : ''}`;
}

/**
 * The record a closed Form keeps of who managed the Employee when it closed,
 * and who closed it. Shown only for a strip that places a recorded manager.
 *
 * @param {{ fields: readonly FormField[] }} section
 * @param {FormItem} item
 * @returns {HTMLElement | null}
 */
function recordedAtCloseView(section, item) {
  const recorded = section.fields.filter((field) =>
    Object.hasOwn(MANAGER_RECORDS, field.itemField)
  );
  if (recorded.length === 0) return null;
  const status = String(item.fields.Status);
  const closedBy = item.fields.ClosedBy;
  return h(
    'section',
    {
      className: 'cora-form-recorded',
      'aria-labelledby': 'form-recorded-heading',
    },
    h('h2', { id: 'form-recorded-heading' }, CLOSED_RECORD_HEADINGS[status]),
    h(
      'dl',
      { className: 'cora-form-recorded-list' },
      ...recorded.flatMap((field) => [
        h('dt', {}, field.label),
        h('dd', {}, readOnlyValue(field, item.fields[field.itemField])),
      ]),
      h('dt', {}, `${closedVerb(status)} by`),
      h(
        'dd',
        {},
        isPerson(closedBy)
          ? `${closedBy.displayName}, ${formatDate(item.fields.ClosedDate)}`
          : h('span', { className: 'cora-form-empty' }, NOTHING_RECORDED)
      )
    )
  );
}

/**
 * How a closing Status is said as something done to the Form, for the record
 * and the locked banner. Completed and Cancelled already read that way.
 *
 * @param {string} status
 * @returns {string}
 */
export function closedVerb(status) {
  /** @type {Record<string, string>} */
  const irregular = { Void: 'Voided' };
  return irregular[status] ?? status;
}

/** @type {Readonly<Record<string, string>>} */
const CLOSED_RECORD_HEADINGS = Object.freeze({
  Completed: 'Recorded at completion',
  Void: 'Recorded when voided',
  Cancelled: 'Recorded when cancelled',
});

/**
 * The Form Actions: an editor while the Form can be changed, and otherwise a
 * card per Action as text. A stored list that would not read is said so in
 * place of either, and nothing is offered that could write over it.
 *
 * @param {{ itemField: string, hint?: string }} section
 * @param {string} id
 * @param {FormItem} item
 * @param {FormSectionsContext} context
 */
function actionsView(section, id, item, context) {
  const headingId = `${id}-heading`;
  const stored = item.fields[section.itemField];
  const actions = /** @type {FormAction[]} */ (
    Array.isArray(stored) ? stored : []
  );
  const unreadable = item.problems.find(
    (problem) => problem.column === section.itemField
  );
  const editing = context.mode === 'edit' && !unreadable;
  return h(
    'section',
    {
      className: 'cora-form-panel cora-form-actions',
      'aria-labelledby': headingId,
    },
    h(
      'header',
      { className: 'cora-form-panel-header' },
      h('h2', { id: headingId }, 'Actions'),
      editing && section.hint
        ? h('p', { className: 'cora-form-panel-hint' }, section.hint)
        : null
    ),
    unreadable
      ? h(
          'p',
          { className: 'cora-forms-error', role: 'alert' },
          `The actions stored on this form could not be read (${unreadable.problem}), so none are shown. They are left as stored, and none can be added or changed here until the list item is corrected.`
        )
      : editing
        ? formActionsEditor(id, actions, {
            removing: context.removingAction,
            onChange: (next) => context.onActions(section.itemField, next),
            onRemoveAsked: context.onRemoveAction,
            onRemoveWithdrawn: context.onRemoveWithdrawn,
          })
        : actionCardsView(actions)
  );
}

/**
 * The Form Actions as text.
 *
 * @param {readonly FormAction[]} actions
 */
function actionCardsView(actions) {
  if (actions.length === 0) {
    return h('p', { className: 'cora-form-empty' }, NOTHING_RECORDED);
  }
  return h(
    'ul',
    { className: 'cora-form-action-list' },
    ...actions.map((action) =>
      h(
        'li',
        { className: 'cora-form-action-card' },
        h('strong', {}, action.title || 'Untitled action'),
        h(
          'p',
          { className: 'cora-form-action-meta' },
          action.dueDate ? `Due ${formatDate(action.dueDate)}` : 'No due date',
          action.status
            ? h('span', { className: 'cora-badge' }, action.status)
            : null
        ),
        action.details
          ? h('p', { className: 'cora-form-value--long' }, action.details)
          : null
      )
    )
  );
}

/** @param {string} text */
function lowerFirst(text) {
  return text.charAt(0).toLowerCase() + text.slice(1);
}
