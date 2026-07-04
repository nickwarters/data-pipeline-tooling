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
 * callbacks, wrapped for the DOM by the `<cora-capture-groups>` element below.
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
 * Tags the field's focusable control(s) with a stable `data-focus-key`. It does
 * double duty: the framework restores focus/scroll to it after a structural
 * re-render, and {@link syncValues} uses it to find the live control for a
 * value-only autosave.
 *
 * @param {HTMLElement} control
 * @param {CaptureField} field
 * @param {string} namePrefix
 */
function applyFocusKey(control, field, namePrefix) {
  const key = focusKeyFor(namePrefix, field.key);
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

/**
 * A stable string describing the editable *structure* (not the values): which
 * groups are shown, their collapse state, and each visible field's identity.
 * When two renders share a signature, only field values can have changed, so
 * {@link syncValues} can update them in place instead of rebuilding.
 *
 * @param {CaptureGroup[]} groups
 * @param {Map<string, boolean>} collapsed
 * @returns {string}
 */
function structureSignature(groups, collapsed) {
  return JSON.stringify(
    groups.map((g) => ({
      k: g.key,
      c: isCollapsed(collapsed, g),
      f: isCollapsed(collapsed, g)
        ? []
        : g.fields.map((fld) => ({
            k: fld.key,
            t: fld.type,
            o: fld.options ?? null,
          })),
    }))
  );
}

/**
 * Pushes current capture values into the already-rendered controls, found by
 * their `data-focus-key`. Rebuilding instead would detach the control the
 * Reviewer is using — losing focus and, because it breaks the browser's scroll
 * anchoring, throwing the page back to the top on every autosave.
 *
 * @param {HTMLElement} host
 * @param {CaptureGroup[]} groups
 * @param {NonNullable<Answer['capture']>} capture
 * @param {string} namePrefix
 * @param {Map<string, boolean>} collapsed
 */
function syncValues(host, groups, capture, namePrefix, collapsed) {
  for (const group of groups) {
    if (isCollapsed(collapsed, group)) continue;
    for (const field of group.fields) {
      const key = focusKeyFor(namePrefix, field.key);
      const value = currentString(capture, field.key);
      if (field.type === 'radio') {
        for (const opt of field.options ?? []) {
          const input = /** @type {any} */ (
            host.querySelector(`[data-focus-key="${key}:${opt}"]`)
          );
          input.checked = opt === value;
        }
      } else {
        /** @type {any} */ (
          host.querySelector(`[data-focus-key="${key}"]`)
        ).value = value;
      }
    }
  }
}

/**
 * The `<cora-capture-groups>` element surface consumers depend on: the props the
 * parent assigns plus the imperative refresh method. Named `CORACaptureGroups` so
 * existing `import('./cora-capture-groups.js').CORACaptureGroups` type references
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
 * }} CORACaptureGroups
 */

/**
 * `<cora-capture-groups>` — the DOM boundary that lets `cora-remediation-section`
 * keep the tag and its imperative `update()` contract. Per-instance ephemeral
 * state (the collapse overrides, radio-name prefix, and last-rendered structure
 * signature) lives on the element; a `tick` signal drives the reactive rebuild
 * for structural changes, while value-only autosaves sync in place (see
 * `update()`) so the Reviewer's focus and page scroll survive.
 */
export const CaptureGroupsElement = defineView('cora-capture-groups', {
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
        /** @type {string | null} Structure last rendered (see update()). */
        signature: null,
      };
    }
    const state = el._captureState;
    // Subscribe the render to the tick so update() and header toggles re-render.
    state.tick.get();

    const nodes = CaptureGroups({
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
          new CustomEvent('cora-capture', {
            detail: { fieldKey, value },
            bubbles: true,
          })
        );
      },
    });

    // Record what we just built so update() can tell a value-only autosave
    // (sync in place) from a structural change (rebuild). Only editable mode
    // has live controls to sync.
    state.signature = el.canCapture
      ? structureSignature(el.groups, state.collapsed)
      : null;
    return nodes;
  },
});

/**
 * Imperative refresh from the parent (`cora-remediation-section`) after an
 * autosave, mirroring the previous class API. Before mount it just seeds the
 * props the first render reads. Once mounted, a value-only change (same
 * structure) syncs into the live controls in place — keeping the Reviewer's
 * focus and page scroll — while a structural change bumps the tick for a full
 * reactive rebuild.
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
  if (!state) return; // not mounted yet; the first render will read these props

  const signature = canCapture
    ? structureSignature(groups, state.collapsed)
    : null;
  if (canCapture && state.signature !== null && signature === state.signature) {
    syncValues(this, groups, capture, state.namePrefix, state.collapsed);
    return;
  }
  state.tick.set(state.tick.get() + 1);
};
