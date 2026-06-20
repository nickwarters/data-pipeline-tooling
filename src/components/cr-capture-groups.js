// @ts-check
import { ReactiveElement } from './reactive-element.js';
import { h } from '../lib/html.js';

/** @typedef {import('../sharepoint-client.js').CaptureGroup} CaptureGroup */
/** @typedef {import('../sharepoint-client.js').CaptureField} CaptureField */
/** @typedef {import('../sharepoint-client.js').Answer} Answer */

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
    const children = this.render() || [];
    this.replaceChildren(...(Array.isArray(children) ? children : [children]));
  }

  render() {
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

    return h('section', { className: 'cr-capture-group' },
      h('button', {
        className: 'cr-capture-group-header',
        'aria-expanded': collapsed ? 'false' : 'true',
        onclick: () => {
          this._collapsed.set(group.key, !this._isCollapsed(group));
          this._render();
        }
      }, group.label),
      !collapsed ? group.fields.map(field => this._renderEditableField(field)) : null
    );
  }

  /**
   * @param {CaptureField} field
   * @returns {HTMLElement}
   */
  _renderEditableField(field) {
    const current = this._currentString(field.key);
    
    let control;
    if (field.type === 'radio') {
      control = this._renderRadio(field, current);
    } else {
      control = this._buildControl(field, current);
      control.addEventListener('change', (/** @type {any} */ ev) => {
        const target = /** @type {{ value: string }} */ (ev.target);
        this._dispatch(field.key, target.value);
      });
    }

    return h('div', { className: 'cr-capture-field' },
      h('label', { className: 'cr-capture-label' }, field.label),
      control
    );
  }

  /**
   * @param {CaptureField} field
   * @param {string} current
   * @returns {HTMLElement}
   */
  _buildControl(field, current) {
    if (field.type === 'select') {
      return h('select', { className: 'cr-capture-input', value: current },
        h('option', { value: '' }, '—'),
        ...(field.options ?? []).map(opt => h('option', { value: opt }, opt))
      );
    }
    if (field.type === 'textarea') {
      return h('textarea', { className: 'cr-capture-input', value: current });
    }
    return h('input', { className: 'cr-capture-input', type: 'text', value: current });
  }

  /**
   * @param {CaptureField} field
   * @param {string} current
   * @returns {HTMLElement}
   */
  _renderRadio(field, current) {
    return h('div', { className: 'cr-capture-radio-group' },
      ...(field.options ?? []).map(opt => 
        h('label', { className: 'cr-capture-radio' },
          h('input', {
            type: 'radio',
            name: field.key,
            value: opt,
            checked: current === opt,
            onchange: () => this._dispatch(field.key, opt)
          }),
          h('span', {}, opt)
        )
      )
    );
  }

  /**
   * @param {CaptureGroup} group
   * @returns {HTMLElement | null}
   */
  _renderReadOnlyGroup(group) {
    const populated = group.fields.filter(f => this._currentString(f.key) !== '');
    if (populated.length === 0) return null;

    return h('section', { className: 'cr-capture-group' },
      h('p', { className: 'cr-capture-group-heading' }, group.label),
      ...populated.map(field => 
        h('p', { className: 'cr-capture-value' }, `${field.label}: ${this._currentString(field.key)}`)
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

customElements.define('cr-capture-groups', CRCaptureGroups);
