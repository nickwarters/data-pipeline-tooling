// @ts-check
import { h } from '../../lib/html.js';
import { buildCaptureControl } from '../../lib/capture-engine.js';
import { PeoplePicker } from '../base/cora-people-picker.js';
import {
  captureDisplayText,
  isEmptyCaptureValue,
  visibleCaptureFields,
} from '../../evaluators/issue-capture.js';

/** @typedef {import('../../sharepoint-client.js').CaptureGroup} CaptureGroup */
/** @typedef {import('../../sharepoint-client.js').CaptureField} CaptureField */
/** @typedef {import('../../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../../sharepoint-client.js').PersonResult} PersonResult */
/** @typedef {import('../../evaluators/issue-capture.js').CaptureValue} CaptureValue */
/** @typedef {{ query: string, people: PersonResult[] }} FieldSearch */

/**
 * A group's collapse state: an ephemeral per-group override (never persisted)
 * falling back to the group's declared default.
 *
 * @param {Map<string, boolean>} collapsed
 * @param {CaptureGroup} group
 * @returns {boolean}
 */
function isCollapsed(collapsed, group) {
  if (collapsed.has(group.key)) {
    return /** @type {boolean} */ (collapsed.get(group.key));
  }
  return group.collapsed ?? false;
}

/**
 * Renders the **Issue Capture Group**s of a single *failed* Answer
 * as a plain array of `h()` nodes — a pure function of its inputs plus two
 * callbacks.
 *
 * In editable mode (`canCapture`) each group is a collapsible section — its
 * default collapse comes from `group.collapsed`, and the Reviewer can toggle it
 * via `onToggle`; the override is ephemeral (never persisted). Each
 * field renders its typed control, named by its caption, and reports edits
 * through `onCapture`. A `person` field renders a
 * people picker fed by `peopleSearch` and `onPersonQuery`, which the caller
 * owns: this view holds no state and runs no search of its own.
 *
 * In read-only mode (`!canCapture`) only populated fields are shown, as static
 * `label: value` text, every group expanded — this is what the Summary renders.
 *
 * @typedef {{
 * groups: CaptureGroup[],
 * capture: NonNullable<Answer['capture']>,
 * canCapture: boolean,
 * namePrefix: string,
 * collapsed: Map<string, boolean>,
 * peopleSearch: Record<string, FieldSearch>,
 * onToggle: (groupKey: string, collapsed: boolean) => void,
 * onCapture: (fieldKey: string, value: CaptureValue | null) => void,
 * onPersonQuery: (fieldKey: string, query: string) => void,
 * }} CaptureGroupsProps
 */

/**
 * @param {CaptureGroupsProps} props
 * @returns {HTMLElement[]}
 */
export function CaptureGroups(props) {
  /** @type {HTMLElement[]} */
  const nodes = [];
  for (const group of props.groups) {
    const section = props.canCapture
      ? editableGroup(group, props)
      : readOnlyGroup(group, props.capture);
    if (section) nodes.push(section);
  }
  return nodes;
}

/**
 * @param {CaptureGroup} group
 * @param {CaptureGroupsProps} props
 * @returns {HTMLElement}
 */
function editableGroup(group, props) {
  const { collapsed, onToggle } = props;
  const collapsedNow = isCollapsed(collapsed, group);

  return h(
    'section',
    { className: 'cora-capture-group' },
    h(
      'button',
      {
        className: 'cora-capture-group-header',
        'aria-expanded': collapsedNow ? 'false' : 'true',
        onclick: () => onToggle(group.key, !collapsedNow),
      },
      group.label
    ),
    !collapsedNow
      ? visibleCaptureFields(group.fields, props.capture).map((field) =>
          editableField(field, props)
        )
      : null
  );
}

/**
 * @param {CaptureField} field
 * @param {CaptureGroupsProps} props
 * @returns {HTMLElement}
 */
function editableField(field, props) {
  const { capture, namePrefix, onCapture } = props;

  // A person is picked, not typed, so it is built here rather than in the
  // shared capture engine: that engine is a domain-free string control builder
  // used by Sections that carry no search state to feed a picker with. The
  // picker names its own input, and the chosen-person form is text plus a
  // button — neither is a control a caption may wrap, so the caption is a plain
  // span beside them.
  if (field.type === 'person') {
    return h(
      'div',
      { className: 'cora-capture-field' },
      h('span', { className: 'cora-capture-label' }, field.label),
      personControl(field, props)
    );
  }

  const control = buildCaptureControl(
    field,
    captureDisplayText(capture[field.key]),
    (value) => onCapture(field.key, value),
    'cora-capture-input',
    namePrefix
  );

  // A `radio` field is several inputs, each already inside its own `<label>`,
  // so the caption names the set with a `<legend>` rather than trying to label
  // one control. Every other type is a single control the caption wraps, which
  // associates the two without needing an id to keep unique across rows.
  if (field.type === 'radio') {
    return h(
      'fieldset',
      { className: 'cora-capture-field' },
      h('legend', { className: 'cora-capture-label' }, field.label),
      control
    );
  }

  return h(
    'label',
    { className: 'cora-capture-field' },
    h('span', { className: 'cora-capture-label' }, field.label),
    control
  );
}

/**
 * The `person` control: a people picker until someone is chosen, then their
 * name plus a clear button.
 *
 * The picker alone offers no way back to nobody — its input holds a query, not
 * the chosen person — so without the collapsed form a Reviewer could attribute
 * a failure and never un-attribute it.
 *
 * @param {CaptureField} field
 * @param {CaptureGroupsProps} props
 * @returns {HTMLElement}
 */
function personControl(field, props) {
  const value = props.capture[field.key];
  if (!isEmptyCaptureValue(value)) {
    return h(
      'div',
      { className: 'cora-capture-person-selected' },
      h(
        'span',
        { className: 'cora-capture-person-current' },
        captureDisplayText(value)
      ),
      h(
        'button',
        {
          className: 'cora-capture-person-clear',
          type: 'button',
          'aria-label': `Clear ${field.label}`,
          onclick: () => props.onCapture(field.key, null),
        },
        '✕'
      )
    );
  }

  const search = props.peopleSearch[field.key] ?? { query: '', people: [] };
  return PeoplePicker({
    placeholder: 'Search people…',
    people: search.people,
    query: search.query,
    inputValue: search.query,
    ariaLabel: `Search people for ${field.label}`,
    onQueryInput: (query) => props.onPersonQuery(field.key, query),
    onSelect: (person) => props.onCapture(field.key, person),
  });
}

/**
 * @param {CaptureGroup} group
 * @param {NonNullable<Answer['capture']>} capture
 * @returns {HTMLElement | null}
 */
function readOnlyGroup(group, capture) {
  // Visibility is applied here too, not only in the editable mode: a Case saved
  // before a `showWhen` was authored still carries values for fields that rule
  // now hides, and no write has come along to prune them.
  const populated = visibleCaptureFields(group.fields, capture).filter(
    (f) => captureDisplayText(capture[f.key]) !== ''
  );
  if (populated.length === 0) return null;

  return h(
    'section',
    { className: 'cora-capture-group' },
    h('p', { className: 'cora-capture-group-heading' }, group.label),
    ...populated.map((field) =>
      h(
        'p',
        { className: 'cora-capture-value' },
        `${field.label}: ${captureDisplayText(capture[field.key])}`
      )
    )
  );
}
