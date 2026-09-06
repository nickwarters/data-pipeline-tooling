// @ts-check
import { h } from '../../lib/html.js';
import { getCaptureFieldType } from '../../capture-fields/registry.js';
import {
  captureDisplayText,
  visibleCaptureFields,
} from '../../evaluators/issue-capture.js';

/** @typedef {import('../../sharepoint-client.js').CaptureGroup} CaptureGroup */
/** @typedef {import('../../sharepoint-client.js').CaptureField} CaptureField */
/** @typedef {import('../../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../../evaluators/issue-capture.js').CaptureValue} CaptureValue */
/** @typedef {import('../../lib/people-search.js').PeopleSearchState} PeopleSearchState */

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
 * field renders the control its own type builds, named the way that type says a
 * caption should name it, and reports edits through `onCapture`. A `person`
 * field renders a people picker fed by `peopleSearch` and `onPersonQuery`,
 * which the caller owns: this view holds no state and runs no search of its
 * own, and no longer knows which type does.
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
 * peopleSearch: Record<string, PeopleSearchState>,
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
  // A field declaring a type nothing renders falls back to a text box, which is
  // what every field got before any type had a module of its own. The verify
  // gate refuses an unknown type, so the only way here is a field declaring
  // none at all.
  const type =
    /** @type {import('../../capture-fields/contract.js').CaptureFieldType} */ (
      getCaptureFieldType(field.type) ?? getCaptureFieldType('text')
    );

  const control = type.editControl({
    field,
    value: props.capture[field.key],
    namePrefix: props.namePrefix,
    onCapture: props.onCapture,
    peopleSearch: props.peopleSearch,
    onPersonQuery: props.onPersonQuery,
  });

  // How the caption names the control is the type's own fact: several inputs
  // each already inside a `<label>` need a `<legend>` naming the set, while one
  // control is wrapped, which associates the two without an id that would have
  // to stay unique across rows.
  if (type.caption === 'legend') {
    return h(
      'fieldset',
      { className: 'cora-capture-field' },
      h('legend', { className: 'cora-capture-label' }, field.label),
      control
    );
  }
  if (type.caption === 'beside') {
    return h(
      'div',
      { className: 'cora-capture-field' },
      h('span', { className: 'cora-capture-label' }, field.label),
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
