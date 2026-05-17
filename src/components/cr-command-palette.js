// @ts-check
import { signal } from '../lib/signal.js';
import { CRElement } from './cr-element.js';
import { el, reactive } from '../question-bank/cr-bank-dom.js';
import {
  isOpen, query, filteredActions, openPalette, closePalette,
} from '../services/command-palette-store.js';

/**
 * @typedef {import('../services/command-palette-store.js').PaletteAction} PaletteAction
 */

export class CRCommandPalette extends CRElement {
  constructor() {
    super();
    this._selIdx = signal(-1);
    this._mode = signal(/** @type {'idle'|'awaiting-input'|'awaiting-option'} */ ('idle'));
    this._pendingAction = signal(/** @type {PaletteAction|null} */ (null));
    this._optionIdx = signal(-1);
    this._onKeydown = this._handleGlobalKeydown.bind(this);
  }

  connectedCallback() {
    document.addEventListener('keydown', this._onKeydown);
    reactive(this, () => this._render());
  }

  disconnectedCallback() {
    document.removeEventListener('keydown', this._onKeydown);
    super.disconnectedCallback();
  }

  /** @param {any} ev */
  _handleGlobalKeydown(ev) {
    if (ev.key === 'k' && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault?.();
      openPalette();
    }
  }

  _render() {
    if (!isOpen.get()) {
      this.replaceChildren();
      return;
    }

    const filtered = filteredActions.get();
    const selIdx = this._selIdx.get();
    const mode = this._mode.get();
    const pending = this._pendingAction.get();
    const optIdx = this._optionIdx.get();

    // Closures read live signal values so they work correctly even when called
    // on a stale (detached) element reference.
    /** @param {any} ev */
    const onInputKeydown = (ev) => {
      const curMode = this._mode.get();
      const curSelIdx = this._selIdx.get();
      const curFiltered = filteredActions.get();
      const curPending = this._pendingAction.get();
      const curOptIdx = this._optionIdx.get();

      if (ev.key === 'Escape') {
        ev.preventDefault?.();
        this._reset();
        return;
      }

      if (curMode === 'awaiting-option') {
        const opts = curPending?.options ?? [];
        if (ev.key === 'ArrowDown') {
          ev.preventDefault?.();
          this._optionIdx.set(Math.min(curOptIdx + 1, opts.length - 1));
        } else if (ev.key === 'ArrowUp') {
          ev.preventDefault?.();
          this._optionIdx.set(Math.max(curOptIdx - 1, 0));
        } else if (ev.key === 'Enter') {
          ev.preventDefault?.();
          const opt = opts[curOptIdx];
          if (!opt) return;
          curPending?.handler(opt.value);
          this._reset();
        }
        return;
      }

      if (ev.key === 'ArrowDown') {
        ev.preventDefault?.();
        this._selIdx.set(Math.min(curSelIdx + 1, curFiltered.length - 1));
        return;
      }
      if (ev.key === 'ArrowUp') {
        ev.preventDefault?.();
        this._selIdx.set(Math.max(curSelIdx - 1, 0));
        return;
      }
      if (ev.key === 'Enter') {
        ev.preventDefault?.();
        const action = curFiltered[curSelIdx];
        if (!action) return;
        this._activateAction(action);
      }
    };

    /** @param {any} ev */
    const onInputChange = (ev) => {
      query.set(ev.target.value);
      this._selIdx.set(-1);
    };

    const inputEl = el('input', {
      class: 'palette-input',
      type: 'text',
      placeholder: 'Type a command…',
      onkeydown: onInputKeydown,
      oninput: onInputChange,
    });

    const listItems = (mode === 'awaiting-option' && pending?.options)
      ? pending.options.map((opt, i) =>
          el('div', { class: 'palette-option' + (i === optIdx ? ' selected' : '') }, opt.label))
      : filtered.map((action, i) =>
          el('div', { class: 'palette-item' + (i === selIdx ? ' selected' : '') }, action.label));

    /** @type {any[]} */
    const extras = [];
    if (mode === 'awaiting-input' && pending) {
      const placeholder = pending.input?.placeholder ?? '';
      /** @param {any} ev */
      const onArgKeydown = (ev) => {
        const curPending = this._pendingAction.get();
        if (ev.key === 'Enter') {
          ev.preventDefault?.();
          if (!curPending) return;
          curPending.handler(ev.target.value);
          this._reset();
        } else if (ev.key === 'Escape') {
          ev.preventDefault?.();
          this._reset();
        }
      };
      extras.push(el('input', {
        class: 'palette-arg-input',
        type: 'text',
        placeholder,
        onkeydown: onArgKeydown,
      }));
    }

    this.replaceChildren(
      el('div', { class: 'palette-overlay' }, inputEl, ...listItems, ...extras)
    );
  }

  /** @param {PaletteAction} action */
  _activateAction(action) {
    if (action.kind === 'input') {
      this._pendingAction.set(action);
      this._mode.set('awaiting-input');
      return;
    }
    if (action.kind === 'options') {
      this._pendingAction.set(action);
      this._optionIdx.set(-1);
      this._mode.set('awaiting-option');
      return;
    }
    action.handler();
    this._reset();
  }

  _reset() {
    this._selIdx.set(-1);
    this._pendingAction.set(null);
    this._mode.set('idle');
    this._optionIdx.set(-1);
    query.set('');
    closePalette();
  }
}

customElements.define('cr-command-palette', CRCommandPalette);
