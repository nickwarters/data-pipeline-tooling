// @ts-check
import { h } from '../../lib/html.js';
import {
  buildCaptureControl,
  applyCaptureTestId,
} from '../../lib/capture-engine.js';
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
 * field renders its typed control carrying a stable `data-testid`
 * (see `testIdFor`) and reports edits through `onCapture`. A `person` field renders a
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
  const { namePrefix, collapsed, onToggle } = props;
  const collapsedNow = isCollapsed(collapsed, group);

  return h(
    'section',
    { className: 'cora-capture-group' },
    h(
      'button',
      {
        className: 'cora-capture-group-header',
        'aria-expanded': collapsedNow ? 'false' : 'true',
        'data-testid': `capture-group:${namePrefix}${group.key}`,
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
  // used by Sections that carry no search state to feed a picker with.
  let control;
  if (field.type === 'person') {
    control = personControl(field, props);
    // The picker wraps its input, so the key goes on the input itself.
    control
      .querySelector('input')
      ?.setAttribute('data-testid', testIdFor(namePrefix, field.key));
  } else {
    control = buildCaptureControl(
      field,
      captureDisplayText(capture[field.key]),
      (value) => onCapture(field.key, value),
      'cora-capture-input',
      namePrefix
    );
    applyCaptureTestId(control, field, testIdFor(namePrefix, field.key));
  }

  return h(
    'div',
    { className: 'cora-capture-field' },
    h('label', { className: 'cora-capture-label' }, field.label),
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
 * The `data-testid` for a field's control, unique per element instance
 * (via `namePrefix`) and per field. Radio options extend it with `:<value>`.
 *
 * Nothing in the app reads it: the renderer preserves focus and caret by
 * matching tag and key, not by this attribute. It is a stable, readable handle
 * for tests and for anyone inspecting the DOM, stamped on the editable control
 * itself — so a `person` field carries it while the picker is showing, and not
 * once a person is chosen and the control is a name plus a clear button.
 *
 * @param {string} namePrefix
 * @param {string} fieldKey
 * @returns {string}
 */
function testIdFor(namePrefix, fieldKey) {
  return `capture:${namePrefix}${fieldKey}`;
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
