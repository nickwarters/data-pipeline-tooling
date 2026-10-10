// @ts-check
/**
 * What a **Form Type** definition is, and what follows from one.
 *
 * A definition is data: its slug, names, list and the sections, panels and
 * fields one generic renderer draws. Everything that decides behaviour — who
 * may read or edit a Form, the lock, the lifecycle buttons, manager prefill —
 * is code shared by every Form Type and is never declared here, so two Form
 * Types cannot disagree about who sees what.
 *
 * The vocabulary below is closed. A section type, panel layout, field type or
 * `editableBy` value outside it is refused by the verify gate before a browser
 * sees the definition.
 */

/**
 * Where a panel's fields are laid out.
 *
 * - `strip` — label and value pairs across the full width, with no heading
 *   drawn; the panel name still names the region for a screen reader.
 * - `question-answer` — one row per field, the label and hint on the left and
 *   the answer on the right.
 * - `stacked` — each field under the one before. The default.
 *
 * @typedef {'strip' | 'question-answer' | 'stacked'} FormPanelLayout
 */

/**
 * Which of a Form's two editors may change a field that only one of them owns.
 * `employee` is the Form's Employee; `manager` is its current first line
 * manager.
 *
 * @typedef {'employee' | 'manager'} FormFieldEditor
 */

/**
 * @typedef {'text' | 'textarea' | 'select' | 'radio' | 'person' | 'date' | 'status'} FormFieldType
 */

/**
 * One field on a Form, stored in the list column named by `itemField`.
 *
 * @typedef {Object} FormField
 * @property {FormFieldType} type
 * @property {string} label
 * @property {string} itemField The SharePoint column, exactly as the list names it.
 * @property {string} [hint]
 * @property {string} [placeholder]
 * @property {boolean} [optional]
 * @property {boolean} [hideLabel] The panel heading already names the field.
 * @property {readonly string[]} [choices] What a `select` or `radio` offers.
 * @property {FormFieldEditor} [editableBy] Only this editor may change it.
 */

/**
 * @typedef {Object} FormPanel
 * @property {string} panelName
 * @property {string} [hint]
 * @property {readonly FormField[]} fields
 */

/**
 * A full-width panel.
 *
 * @typedef {Object} FormPanelSection
 * @property {'panel'} sectionType
 * @property {string} panelName
 * @property {string} [hint]
 * @property {FormPanelLayout} [layout]
 * @property {readonly FormField[]} fields
 */

/**
 * Two panels side by side, stacking when the page is narrow.
 *
 * @typedef {Object} FormSplitPanelSection
 * @property {'split-panel'} sectionType
 * @property {readonly FormPanel[]} panels
 */

/**
 * The shared Form Actions editor. A Form holds at most three Form Actions,
 * whatever its type, so a definition cannot set a limit of its own.
 *
 * @typedef {Object} FormActionsSection
 * @property {'actions'} sectionType
 * @property {string} itemField
 * @property {string} [hint]
 */

/** @typedef {FormPanelSection | FormSplitPanelSection | FormActionsSection} FormSection */

/**
 * @typedef {Object} FormTypeDefinition
 * @property {string} slug The route segment, e.g. `#/forms/<slug>`.
 * @property {string} formName What a person calls it.
 * @property {string} description
 * @property {string} listName The list's name before the environment prefix,
 *   which is added centrally like every other list's.
 * @property {readonly FormSection[]} sections
 */

/** The section types a definition may use. */
export const FORM_SECTION_TYPES = Object.freeze([
  'panel',
  'split-panel',
  'actions',
]);

/** The layouts a full-width panel may take, and the one it takes by default. */
export const FORM_PANEL_LAYOUTS = Object.freeze([
  'strip',
  'question-answer',
  'stacked',
]);

/** Who `editableBy` may name. */
export const FORM_FIELD_EDITORS = Object.freeze(['employee', 'manager']);

/** The field types that offer a fixed list of choices. */
export const CHOICE_FIELD_TYPES = Object.freeze(['select', 'radio']);

/**
 * Every field type a definition may use, and whether its column holds the
 * value as written or encoded.
 *
 * Encoding follows the type, never a flag on the field, so there is nothing
 * per field to forget. People, dates, choices and the Status stay plain
 * because queries and the access rule read them, and an encoded column cannot
 * be filtered, sorted or indexed. Free text is encoded so it is not readable at
 * a glance in the list. Encoding is not encryption: anyone who can read the
 * list can decode it.
 *
 * @type {Readonly<Record<FormFieldType, 'plain' | 'encoded'>>}
 */
export const FORM_FIELD_STORAGE = Object.freeze({
  text: 'encoded',
  textarea: 'encoded',
  select: 'plain',
  radio: 'plain',
  person: 'plain',
  date: 'plain',
  status: 'plain',
});

/**
 * Every Form Status, whatever the Form's type. A Form is Pending until it
 * closes. These are a Form's vocabulary and share nothing with a Case's
 * lifecycle statuses, two of which happen to be spelt the same.
 */
export const FORM_STATUSES = Object.freeze([
  'Pending',
  'Completed',
  'Void',
  'Cancelled',
]);

/** The Form Status values that lock a Form for everyone. */
export const CLOSED_FORM_STATUSES = Object.freeze([
  'Completed',
  'Void',
  'Cancelled',
]);

/**
 * The columns the application owns, with the field type each must have.
 *
 * Access reads `Employee` and the two current managers and nothing else, the
 * lock reads `Status`, and the archive's date window reads `ClosedDate`, so a
 * definition may place these on the page but cannot store them anywhere else,
 * give them another type or let anyone edit them after creation. `placedBy`
 * says who draws each one: the page draws the Status badge, the current
 * managers and the closed date itself, so a definition has to place only the
 * two it would otherwise leave off the page.
 *
 * `ClosedDate` is the day a lifecycle button closed the Form, and empty while
 * it is open. The archive windows on it rather than on `Modified`, which moves
 * whenever anything touches the item, the current managers being kept up to
 * date included, and would drag long-closed Forms back into a recent window.
 *
 * @type {Readonly<Record<string, { type: FormFieldType, placedBy: 'definition' | 'page' }>>}
 */
export const FORM_OWNED_FIELDS = Object.freeze({
  Employee: { type: 'person', placedBy: 'definition' },
  CurrentFirstLineManager: { type: 'person', placedBy: 'page' },
  CurrentSecondLineManager: { type: 'person', placedBy: 'page' },
  Status: { type: 'status', placedBy: 'page' },
  DueDate: { type: 'date', placedBy: 'definition' },
  ClosedDate: { type: 'date', placedBy: 'page' },
});

/**
 * Every field a definition declares, in page order, whichever section or panel
 * holds it. The Actions section is a section, not a field, so it is not here.
 *
 * @param {FormTypeDefinition} definition
 * @returns {FormField[]}
 */
export function formFields(definition) {
  return definition.sections.flatMap((section) => {
    if (section.sectionType === 'panel') return [...section.fields];
    if (section.sectionType === 'split-panel') {
      return section.panels.flatMap((panel) => [...panel.fields]);
    }
    return [];
  });
}

/**
 * The columns a Form of this type is read and written through, split by how
 * each one is stored.
 *
 * The application's own columns come first and are always present, placed on
 * the page or not, because access and the lock read them on every Form. The
 * Actions column is encoded like the free text it holds. This is the one list
 * the list client selects and encodes from, and the one the provisioning
 * runbook builds the list's columns from.
 *
 * @param {FormTypeDefinition} definition
 * @returns {{ plain: string[], encoded: string[] }}
 */
export function formColumns(definition) {
  /** @type {Set<string>} */
  const plain = new Set(Object.keys(FORM_OWNED_FIELDS));
  /** @type {Set<string>} */
  const encoded = new Set();
  for (const field of formFields(definition)) {
    if (plain.has(field.itemField)) continue;
    // A type this table does not know is encoded rather than left readable:
    // the gate refuses one, and if it ever slips past, the cost of the wrong
    // answer is a column nobody can filter on rather than text in the clear.
    const storage = FORM_FIELD_STORAGE[field.type];
    (storage === 'plain' ? plain : encoded).add(field.itemField);
  }
  for (const section of definition.sections) {
    if (section.sectionType === 'actions') encoded.add(section.itemField);
  }
  return { plain: [...plain], encoded: [...encoded] };
}
