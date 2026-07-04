// @ts-check
import { signal } from '../lib/signal.js';
import { defineView } from '../lib/view.js';
import { h } from '../lib/html.js';
import { buildCaptureControl } from '../lib/capture-engine.js';

/** @typedef {import('../sharepoint-client.js').CaptureGroup} CaptureGroup */
/** @typedef {import('../sharepoint-client.js').CaptureField} CaptureField */
/** @typedef {import('../sharepoint-client.js').Answer} Answer */

/** Per-instance counter so each element scopes its radio-group `name`s. */
let uid = 0;

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
 * ADR-0020) falling back to the group's declared default.
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
 * Renders the **Issue Capture Group**s of a single *failed* Answer (ADR-0020)
 * as a plain array of `h()` nodes — a pure function of its inputs plus two
 * callbacks, wrapped for the DOM by the `<cr-capture-groups>` element below.
 *
 * In editable mode (`canCapture`) each group is a collapsible section — its
 * default collapse comes from `group.collapsed`, and the Reviewer can toggle it
 * via `onToggle`; the override is ephemeral (never persisted, ADR-0020). Each
 * field renders its typed control (this slice: `text`/`textarea`/`select`/
 * `radio`) carrying a stable `data-focus-key` so the framework restores the
 * Reviewer's focus and scroll across an autosave-driven re-render, and reports
 * edits through `onCapture`.
 *
 * In read-only mode (`!canCapture`) only populated fields are shown, as static
 * `label: value` text, every group expanded — this is what the Summary renders.
 *
 * @param {{
 *   groups: CaptureGroup[],
 *   capture: NonNullable<Answer['capture']>,
 *   canCapture: boolean,
 *   namePrefix: string,
 *   collapsed: Map<string, boolean>,
 *   onToggle: (groupKey: string, collapsed: boolean) => void,
 *   onCapture: (fieldKey: string, value: string) => void,
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
    { className: 'cr-capture-group' },
    h(
      'button',
      {
        className: 'cr-capture-group-header',
        'aria-expanded': collapsedNow ? 'false' : 'true',
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
    'cr-capture-input',
    namePrefix
  );
  applyFocusKey(control, field, namePrefix);

  return h(
    'div',
    { className: 'cr-capture-field' },
    h('label', { className: 'cr-capture-label' }, field.label),
    control
  );
}

/**
 * Tags the field's focusable control(s) with a stable `data-focus-key` so a
 * framework-managed re-render can return focus (and the page scroll) to the
 * control the Reviewer was using. Radio groups key each option separately; all
 * other controls key the single input.
 *
 * @param {HTMLElement} control
 * @param {CaptureField} field
 * @param {string} namePrefix
 */
function applyFocusKey(control, field, namePrefix) {
  const key = `capture:${namePrefix}${field.key}`;
  if (field.type === 'radio') {
    for (const input of control.querySelectorAll('input')) {
      input.setAttribute('data-focus-key', `${key}:${input.value}`);
    }
  } else {
    control.setAttribute('data-focus-key', key);
  }
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
    { className: 'cr-capture-group' },
    h('p', { className: 'cr-capture-group-heading' }, group.label),
    ...populated.map((field) =>
      h(
        'p',
        { className: 'cr-capture-value' },
        `${field.label}: ${currentString(capture, field.key)}`
      )
    )
  );
}

/**
 * The `<cr-capture-groups>` element surface consumers depend on: the props the
 * parent assigns plus the imperative refresh method. Named `CRCaptureGroups` so
 * existing `import('./cr-capture-groups.js').CRCaptureGroups` type references
 * (which the old class name provided) keep resolving to the element instance;
 * the element constructor below is a separate value so the two never clash.
 *
 * @typedef {HTMLElement & {
 *   groups: CaptureGroup[],
 *   capture: NonNullable<Answer['capture']>,
 *   canCapture: boolean,
 *   update: (
 *     groups: CaptureGroup[],
 *     capture: NonNullable<Answer['capture']>,
 *     canCapture: boolean
 *   ) => void,
 * }} CRCaptureGroups
 */

/**
 * `<cr-capture-groups>` — the DOM boundary that lets `cr-remediation-section`
 * keep the tag and its imperative `update()` contract. Per-instance ephemeral
 * state (the collapse overrides and the radio-name prefix) lives on the element;
 * a `tick` signal drives the reactive re-render, and `defineView` supplies the
 * `data-focus-key` focus/scroll preservation that the old bespoke value-sync
 * fast path used to hand-roll.
 */
export const CaptureGroupsElement = defineView('cr-capture-groups', {
  props:
    /** @type {{ groups: CaptureGroup[], capture: NonNullable<Answer['capture']>, canCapture: boolean }} */ ({
      groups: [],
      capture: {},
      canCapture: false,
    }),
  render({ host }) {
    const el = /** @type {any} */ (host);
    if (!el._captureState) {
      el._captureState = {
        namePrefix: `cg${uid++}-`,
        /** @type {Map<string, boolean>} */
        collapsed: new Map(),
        tick: signal(0),
      };
    }
    const state = el._captureState;
    // Subscribe the render to the tick so update() and header toggles re-render.
    state.tick.get();

    return CaptureGroups({
      groups: el.groups,
      capture: el.capture,
      canCapture: el.canCapture,
      namePrefix: state.namePrefix,
      collapsed: state.collapsed,
      onToggle: (key, collapsedNext) => {
        state.collapsed.set(key, collapsedNext);
        state.tick.set(state.tick.get() + 1);
      },
      onCapture: (fieldKey, value) => {
        el.dispatchEvent(
          new CustomEvent('cr-capture', {
            detail: { fieldKey, value },
            bubbles: true,
          })
        );
      },
    });
  },
});

/**
 * Imperative refresh from the parent (`cr-remediation-section`) after an
 * autosave, mirroring the previous class API: assign the inputs and, once the
 * element is mounted, poke the tick so the reactive render reruns. Before mount
 * this simply seeds the props that the first render will read.
 *
 * @param {CaptureGroup[]} groups
 * @param {NonNullable<Answer['capture']>} capture
 * @param {boolean} canCapture
 */
CaptureGroupsElement.prototype.update = function (groups, capture, canCapture) {
  this.groups = groups;
  this.capture = capture;
  this.canCapture = canCapture;
  const state = /** @type {any} */ (this)._captureState;
  if (state) state.tick.set(state.tick.get() + 1);
};
