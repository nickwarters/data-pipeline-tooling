// @ts-check
import { h } from '../../lib/html.js';
import {
  buildCaptureControl,
  applyCaptureFocusKey,
} from '../../lib/capture-engine.js';

/** @typedef {import('../../sharepoint-client.js').CaptureGroup} CaptureGroup */
/** @typedef {import('../../sharepoint-client.js').CaptureField} CaptureField */
/** @typedef {import('../../sharepoint-client.js').Answer} Answer */

/**
 * The current value of a string field key, '' when absent or non-string (a
 * `person`/`actions` value is not exercised by this slice).
 *
 * @param {NonNullable<Answer['capture']>} capture
 * @param {string} key
 * @returns {string}
 */
function currentString(capture, key) {
  const v = capture[key];
  return typeof v === 'string' ? v : '';
}

/**
 * A group's collapse state: an ephemeral per-group override (never persisted,
 * the architecture decision) falling back to the group's declared default.
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
 * via `onToggle`; the override is ephemeral (never persisted, the architecture decision). Each
 * field renders its typed control (this slice: `text`/`textarea`/`select`/
 * `radio`) carrying a stable `data-focus-key` so the framework restores the
 * Reviewer's focus and scroll across an autosave-driven re-render, and reports
 * edits through `onCapture`.
 *
 * In read-only mode (`!canCapture`) only populated fields are shown, as static
 * `label: value` text, every group expanded — this is what the Summary renders.
 *
 * @param {{
 * groups: CaptureGroup[],
 * capture: NonNullable<Answer['capture']>,
 * canCapture: boolean,
 * namePrefix: string,
 * collapsed: Map<string, boolean>,
 * onToggle: (groupKey: string, collapsed: boolean) => void,
 * onCapture: (fieldKey: string, value: string) => void,
 * }} props
 * @returns {HTMLElement[]}
 */
export function CaptureGroups({
  groups,
  capture,
  canCapture,
  namePrefix,
  collapsed,
  onToggle,
  onCapture,
}) {
  /** @type {HTMLElement[]} */
  const nodes = [];
  for (const group of groups) {
    const section = canCapture
      ? editableGroup(
          group,
          capture,
          namePrefix,
          collapsed,
          onToggle,
          onCapture
        )
      : readOnlyGroup(group, capture);
    if (section) nodes.push(section);
  }
  return nodes;
}

/**
 * @param {CaptureGroup} group
 * @param {NonNullable<Answer['capture']>} capture
 * @param {string} namePrefix
 * @param {Map<string, boolean>} collapsed
 * @param {(groupKey: string, collapsed: boolean) => void} onToggle
 * @param {(fieldKey: string, value: string) => void} onCapture
 * @returns {HTMLElement}
 */
function editableGroup(
  group,
  capture,
  namePrefix,
  collapsed,
  onToggle,
  onCapture
) {
  const collapsedNow = isCollapsed(collapsed, group);

  return h(
    'section',
    { className: 'cora-capture-group' },
    h(
      'button',
      {
        className: 'cora-capture-group-header',
        'aria-expanded': collapsedNow ? 'false' : 'true',
        // Toggling rebuilds this element; keying the header (which the click
        // focuses) lets the framework refocus it afterwards and hold the page
        // scroll instead of jumping to the top.
        'data-focus-key': `capture-group:${namePrefix}${group.key}`,
        onclick: () => onToggle(group.key, !collapsedNow),
      },
      group.label
    ),
    !collapsedNow
      ? group.fields.map((field) =>
          editableField(field, capture, namePrefix, onCapture)
        )
      : null
  );
}

/**
 * @param {CaptureField} field
 * @param {NonNullable<Answer['capture']>} capture
 * @param {string} namePrefix
 * @param {(fieldKey: string, value: string) => void} onCapture
 * @returns {HTMLElement}
 */
function editableField(field, capture, namePrefix, onCapture) {
  const control = buildCaptureControl(
    field,
    currentString(capture, field.key),
    (value) => onCapture(field.key, value),
    'cora-capture-input',
    namePrefix
  );
  applyFocusKey(control, field, namePrefix);

  return h(
    'div',
    { className: 'cora-capture-field' },
    h('label', { className: 'cora-capture-label' }, field.label),
    control
  );
}

/**
 * The `data-focus-key` for a field's control, unique per element instance
 * (via `namePrefix`) and per field. Radio options extend it with `:<value>`.
 *
 * @param {string} namePrefix
 * @param {string} fieldKey
 * @returns {string}
 */
function focusKeyFor(namePrefix, fieldKey) {
  return `capture:${namePrefix}${fieldKey}`;
}

/**
 * Tags the field's focusable control(s) with a stable `data-focus-key`, which
 * lets the store renderer restore focus after a structural re-render. The
 * engine that built the control knows how to tag it.
 *
 * @param {HTMLElement} control
 * @param {CaptureField} field
 * @param {string} namePrefix
 */
function applyFocusKey(control, field, namePrefix) {
  applyCaptureFocusKey(control, field, focusKeyFor(namePrefix, field.key));
}

/**
 * @param {CaptureGroup} group
 * @param {NonNullable<Answer['capture']>} capture
 * @returns {HTMLElement | null}
 */
function readOnlyGroup(group, capture) {
  const populated = group.fields.filter(
    (f) => currentString(capture, f.key) !== ''
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
        `${field.label}: ${currentString(capture, field.key)}`
      )
    )
  );
}
