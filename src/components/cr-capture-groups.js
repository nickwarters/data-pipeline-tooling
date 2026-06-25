// @ts-check
import { ReactiveElement } from './reactive-element.js';
import { h } from '../lib/html.js';
import { buildCaptureControl } from '../lib/capture-engine.js';

/** @typedef {import('../sharepoint-client.js').CaptureGroup} CaptureGroup */
/** @typedef {import('../sharepoint-client.js').CaptureField} CaptureField */
/** @typedef {import('../sharepoint-client.js').Answer} Answer */

/** Per-instance counter so each component scopes its radio-group `name`s. */
let uid = 0;

/**
 * Renders the **Issue Capture Group**s of a single *failed* Answer (ADR-0020).
 *
 * In editable mode (`canCapture`) each group is a collapsible section — its
 * default collapse comes from `group.collapsed`, and the Reviewer can toggle it;
 * the toggle is ephemeral instance state (never persisted, ADR-0020). Each field
 * renders its typed control (this slice: `text`/`textarea`/`select`/`radio`) and
 * dispatches a bubbling `cr-capture` carrying the field key and new value;
 * persistence is the page's responsibility so the answers signal stays the single
 * source of truth.
 *
 * In read-only mode (`!canCapture`) only populated fields are shown, as static
 * `label: value` text, every group expanded — this is what the Summary renders.
 */
export class CRCaptureGroups extends ReactiveElement {
  constructor() {
    super();
    /** @type {CaptureGroup[]} */
    this.groups = [];
    /** @type {NonNullable<Answer['capture']>} */
    this.capture = {};
    /** @type {boolean} Whether the viewer may edit (controls vs static text). */
    this.canCapture = false;
    /**
     * Ephemeral per-group collapse overrides keyed by group key (ADR-0020): not
     * persisted, surviving only re-renders within this component's lifetime.
     * @type {Map<string, boolean>}
     */
    this._collapsed = new Map();
    /**
     * Per-field value setters from the most recent editable build, keyed by field
     * key. Lets a value-only re-render (the common autosave case) push new values
     * into the existing controls instead of rebuilding the DOM.
     * @type {Map<string, (value: string) => void>}
     */
    this._fieldSetters = new Map();
    /**
     * Signature of the structure last rendered in editable mode. When an update
     * leaves it unchanged, only field values can have changed, so we sync them in
     * place rather than tearing the controls down — which would otherwise detach
     * the control the Reviewer is using, losing focus and resetting page scroll.
     * @type {string | null}
     */
    this._builtSig = null;
    /**
     * Unique radio-name prefix for this instance. Without it, every failed
     * Answer's identically-keyed radios (e.g. `repeatIssue`) would share a
     * `name` and form one cross-Answer native radio group — picking one would
     * clear the others.
     */
    this._uid = `cg${uid++}-`;
  }

  connectedCallback() {
    super.connectedCallback();
    this._render();
  }

  /**
   * @param {CaptureGroup[]} groups
   * @param {NonNullable<Answer['capture']>} capture
   * @param {boolean} canCapture
   */
  update(groups, capture, canCapture) {
    this.groups = groups;
    this.capture = capture;
    this.canCapture = canCapture;
    this._render();
  }

  _render() {
    // Fast path: in editable mode, when only field values changed (same groups,
    // fields, collapse state and edit-ability), push them into the live controls
    // instead of rebuilding. Rebuilding detaches the control the Reviewer just
    // touched, which loses focus and — because it breaks the browser's scroll
    // anchoring — throws the page back to the top on every capture edit.
    if (
      this.canCapture &&
      this._builtSig !== null &&
      this._builtSig === this._signature()
    ) {
      this._syncValues();
      return;
    }
    const children = this.render() || [];
    this.replaceChildren(...(Array.isArray(children) ? children : [children]));
    this._builtSig = this.canCapture ? this._signature() : null;
  }

  render() {
    this._fieldSetters = new Map();
    const children = [];
    for (const group of this.groups) {
      const section = this.canCapture
        ? this._renderEditableGroup(group)
        : this._renderReadOnlyGroup(group);
      if (section) children.push(section);
    }
    return children;
  }

  /**
   * A stable string describing the editable structure (not the values): which
   * groups are shown, their collapse state, and each visible field's identity.
   * @returns {string}
   */
  _signature() {
    return JSON.stringify(
      this.groups.map((g) => ({
        k: g.key,
        c: this._isCollapsed(g),
        f: this._isCollapsed(g)
          ? []
          : g.fields.map((fld) => ({
              k: fld.key,
              t: fld.type,
              o: fld.options ?? null,
            })),
      }))
    );
  }

  /** Push current capture values into the live controls (no DOM teardown). */
  _syncValues() {
    for (const [key, setValue] of this._fieldSetters) {
      setValue(this._currentString(key));
    }
  }

  /**
   * @param {CaptureGroup} group
   * @returns {boolean}
   */
  _isCollapsed(group) {
    if (this._collapsed.has(group.key)) {
      return /** @type {boolean} */ (this._collapsed.get(group.key));
    }
    return group.collapsed ?? false;
  }

  /**
   * @param {CaptureGroup} group
   * @returns {HTMLElement}
   */
  _renderEditableGroup(group) {
    const collapsed = this._isCollapsed(group);

    return h(
      'section',
      { className: 'cr-capture-group' },
      h(
        'button',
        {
          className: 'cr-capture-group-header',
          'aria-expanded': collapsed ? 'false' : 'true',
          onclick: () => {
            this._collapsed.set(group.key, !this._isCollapsed(group));
            this._render();
          },
        },
        group.label
      ),
      !collapsed
        ? group.fields.map((field) => this._renderEditableField(field))
        : null
    );
  }

  /**
   * @param {CaptureField} field
   * @returns {HTMLElement}
   */
  _renderEditableField(field) {
    const current = this._currentString(field.key);

    const control = buildCaptureControl(
      field,
      current,
      (value) => {
        this._dispatch(field.key, value);
      },
      'cr-capture-input',
      this._uid
    );

    this._fieldSetters.set(field.key, this._makeSetter(field, control));

    return h(
      'div',
      { className: 'cr-capture-field' },
      h('label', { className: 'cr-capture-label' }, field.label),
      control
    );
  }

  /**
   * Builds a setter that applies a value to an already-rendered control, so a
   * value-only re-render needn't recreate it. Radio groups toggle the matching
   * input's `checked`; everything else (text/textarea/select) sets `.value`.
   * @param {CaptureField} field
   * @param {HTMLElement} control
   * @returns {(value: string) => void}
   */
  _makeSetter(field, control) {
    if (field.type === 'radio') {
      const inputs = collectInputs(control);
      return (value) => {
        for (const input of inputs) input.checked = input.value === value;
      };
    }
    return (value) => {
      /** @type {any} */ (control).value = value;
    };
  }

  /**
   * @param {CaptureGroup} group
   * @returns {HTMLElement | null}
   */
  _renderReadOnlyGroup(group) {
    const populated = group.fields.filter(
      (f) => this._currentString(f.key) !== ''
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
          `${field.label}: ${this._currentString(field.key)}`
        )
      )
    );
  }

  /**
   * The current value of a string field key, '' when absent or non-string (a
   * `person`/`actions` value is not exercised by this slice).
   *
   * @param {string} key
   * @returns {string}
   */
  _currentString(key) {
    const v = this.capture[key];
    return typeof v === 'string' ? v : '';
  }

  /**
   * @param {string} fieldKey
   * @param {string} value
   */
  _dispatch(fieldKey, value) {
    this.dispatchEvent(
      new CustomEvent('cr-capture', {
        detail: { fieldKey, value },
        bubbles: true,
      })
    );
  }
}

/**
 * Collects descendant `<input>` elements. Walks `children` (real DOM) or
 * `_children` (test stubs) so it works in both environments.
 * @param {any} el
 * @param {any[]} [out]
 * @returns {any[]}
 */
function collectInputs(el, out = []) {
  const kids = el.children ? Array.from(el.children) : (el._children ?? []);
  for (const k of kids) {
    const tag = (k.tagName || k._tagName || '').toLowerCase();
    if (tag === 'input') out.push(k);
    else collectInputs(k, out);
  }
  return out;
}

customElements.define('cr-capture-groups', CRCaptureGroups);
