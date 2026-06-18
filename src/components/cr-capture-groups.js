// @ts-check
import { CRElement } from './cr-element.js';

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
export class CRCaptureGroups extends CRElement {
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
    /** @type {Node[]} */
    const children = [];
    for (const group of this.groups) {
      const section = this.canCapture
        ? this._renderEditableGroup(group)
        : this._renderReadOnlyGroup(group);
      if (section) children.push(/** @type {any} */ (section));
    }
    this.replaceChildren(...children);
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
    const section = document.createElement('section');
    section.className = 'cr-capture-group';

    const collapsed = this._isCollapsed(group);

    const header = document.createElement('button');
    header.className = 'cr-capture-group-header';
    header.textContent = group.label;
    header.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    header.addEventListener('click', () => {
      this._collapsed.set(group.key, !this._isCollapsed(group));
      this._render();
    });
    section.appendChild(header);

    if (!collapsed) {
      for (const field of group.fields) {
        section.appendChild(/** @type {any} */ (this._renderEditableField(field)));
      }
    }
    return section;
  }

  /**
   * @param {CaptureField} field
   * @returns {HTMLElement}
   */
  _renderEditableField(field) {
    const wrap = document.createElement('div');
    wrap.className = 'cr-capture-field';

    const label = document.createElement('label');
    label.className = 'cr-capture-label';
    label.textContent = field.label;
    wrap.appendChild(label);

    const current = this._currentString(field.key);
    if (field.type === 'radio') {
      wrap.appendChild(/** @type {any} */ (this._renderRadio(field, current)));
    } else {
      const control = this._buildControl(field, current);
      control.addEventListener('change', (ev) => {
        const target = /** @type {{ value: string }} */ (/** @type {any} */ (ev).target);
        this._dispatch(field.key, target.value);
      });
      wrap.appendChild(/** @type {any} */ (control));
    }
    return wrap;
  }

  /**
   * @param {CaptureField} field
   * @param {string} current
   * @returns {HTMLElement}
   */
  _buildControl(field, current) {
    if (field.type === 'select') {
      const select = /** @type {any} */ (document.createElement('select'));
      select.className = 'cr-capture-input';
      const blank = /** @type {any} */ (document.createElement('option'));
      blank.value = '';
      blank.textContent = '—';
      select.appendChild(blank);
      for (const opt of field.options ?? []) {
        const option = /** @type {any} */ (document.createElement('option'));
        option.value = opt;
        option.textContent = opt;
        select.appendChild(option);
      }
      select.value = current;
      return select;
    }
    if (field.type === 'textarea') {
      const textarea = /** @type {any} */ (document.createElement('textarea'));
      textarea.className = 'cr-capture-input';
      textarea.value = current;
      return textarea;
    }
    const input = /** @type {any} */ (document.createElement('input'));
    input.className = 'cr-capture-input';
    input.type = 'text';
    input.value = current;
    return input;
  }

  /**
   * @param {CaptureField} field
   * @param {string} current
   * @returns {HTMLElement}
   */
  _renderRadio(field, current) {
    const group = document.createElement('div');
    group.className = 'cr-capture-radio-group';
    for (const opt of field.options ?? []) {
      const optLabel = document.createElement('label');
      optLabel.className = 'cr-capture-radio';

      const input = /** @type {any} */ (document.createElement('input'));
      input.type = 'radio';
      input.name = field.key;
      input.value = opt;
      input.checked = current === opt;
      input.addEventListener('change', () => this._dispatch(field.key, opt));

      const span = document.createElement('span');
      span.textContent = opt;

      optLabel.appendChild(/** @type {any} */ (input));
      optLabel.appendChild(/** @type {any} */ (span));
      group.appendChild(optLabel);
    }
    return group;
  }

  /**
   * @param {CaptureGroup} group
   * @returns {HTMLElement | null}
   */
  _renderReadOnlyGroup(group) {
    const populated = group.fields.filter(f => this._currentString(f.key) !== '');
    if (populated.length === 0) return null;

    const section = document.createElement('section');
    section.className = 'cr-capture-group';

    const heading = document.createElement('p');
    heading.className = 'cr-capture-group-heading';
    heading.textContent = group.label;
    section.appendChild(heading);

    for (const field of populated) {
      const value = document.createElement('p');
      value.className = 'cr-capture-value';
      value.textContent = `${field.label}: ${this._currentString(field.key)}`;
      section.appendChild(value);
    }
    return section;
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
