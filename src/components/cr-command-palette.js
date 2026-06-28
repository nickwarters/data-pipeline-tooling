// @ts-check
import { signal } from '../lib/signal.js';
import { ShellElement } from '../lib/view.js';
import { h } from '../lib/html.js';
import {
  isOpen,
  query,
  filteredActions,
  openPalette,
  closePalette,
} from '../services/command-palette-store.js';

/**
 * @typedef {import('../services/command-palette-store.js').PaletteAction} PaletteAction
 */

/**
 * @typedef {object} CommandPaletteState
 * @property {import('../lib/signal.js').Signal<number>} selIdx
 * @property {import('../lib/signal.js').Signal<'idle'|'awaiting-input'|'awaiting-option'>} mode
 * @property {import('../lib/signal.js').Signal<PaletteAction|null>} pendingAction
 * @property {import('../lib/signal.js').Signal<number>} optionIdx
 * @property {(action: PaletteAction) => void} activateAction
 * @property {() => void} reset
 */

/**
 * @returns {CommandPaletteState}
 */
export function createCommandPaletteState() {
  const state = {
    selIdx: signal(-1),
    mode: signal(
      /** @type {'idle'|'awaiting-input'|'awaiting-option'} */ ('idle')
    ),
    pendingAction: signal(/** @type {PaletteAction|null} */ (null)),
    optionIdx: signal(-1),
    activateAction: (/** @type {PaletteAction} */ action) => {
      if (action.kind === 'input') {
        state.pendingAction.set(action);
        state.mode.set('awaiting-input');
        return;
      }
      if (action.kind === 'options') {
        state.pendingAction.set(action);
        state.optionIdx.set(-1);
        state.mode.set('awaiting-option');
        return;
      }
      action.handler();
      state.reset();
    },
    reset: () => {
      state.selIdx.set(-1);
      state.pendingAction.set(null);
      state.mode.set('idle');
      state.optionIdx.set(-1);
      query.set('');
      closePalette();
    },
  };
  return state;
}

/**
 * @param {{ addEventListener(type: string, listener: (ev: any) => void): void, removeEventListener(type: string, listener: (ev: any) => void): void }} target
 * @returns {() => void}
 */
export function bindCommandPaletteShortcut(target) {
  /** @param {any} ev */
  const onKeydown = (ev) => {
    if (ev.key === 'k' && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault?.();
      openPalette();
    }
  };
  target.addEventListener('keydown', onKeydown);
  return () => target.removeEventListener('keydown', onKeydown);
}

/**
 * @param {CommandPaletteState} state
 * @returns {Node[] | Node}
 */
export function CommandPalette(state) {
  if (!isOpen.get()) {
    return [];
  }

  const filtered = filteredActions.get();
  const selIdx = state.selIdx.get();
  const mode = state.mode.get();
  const pending = state.pendingAction.get();
  const optIdx = state.optionIdx.get();

  // Closures read live signal values so they work correctly even when called
  // on a stale (detached) element reference.
  /** @param {any} ev */
  const onInputKeydown = (ev) => {
    const curMode = state.mode.get();
    const curSelIdx = state.selIdx.get();
    const curFiltered = filteredActions.get();
    const curPending = state.pendingAction.get();
    const curOptIdx = state.optionIdx.get();

    if (ev.key === 'Escape') {
      ev.preventDefault?.();
      state.reset();
      return;
    }

    if (curMode === 'awaiting-option') {
      const opts = curPending?.options ?? [];
      if (ev.key === 'ArrowDown') {
        ev.preventDefault?.();
        state.optionIdx.set(Math.min(curOptIdx + 1, opts.length - 1));
      } else if (ev.key === 'ArrowUp') {
        ev.preventDefault?.();
        state.optionIdx.set(Math.max(curOptIdx - 1, 0));
      } else if (ev.key === 'Enter') {
        ev.preventDefault?.();
        const opt = opts[curOptIdx];
        if (!opt) return;
        curPending?.handler(opt.value);
        state.reset();
      }
      return;
    }

    if (ev.key === 'ArrowDown') {
      ev.preventDefault?.();
      state.selIdx.set(Math.min(curSelIdx + 1, curFiltered.length - 1));
      return;
    }
    if (ev.key === 'ArrowUp') {
      ev.preventDefault?.();
      state.selIdx.set(Math.max(curSelIdx - 1, 0));
      return;
    }
    if (ev.key === 'Enter') {
      ev.preventDefault?.();
      const action = curFiltered[curSelIdx];
      if (!action) return;
      state.activateAction(action);
    }
  };

  /** @param {any} ev */
  const onInputChange = (ev) => {
    query.set(ev.target.value);
    state.selIdx.set(-1);
  };

  const inputEl = h('input', {
    className: 'palette-input',
    type: 'text',
    placeholder: 'Type a command…',
    onkeydown: onInputKeydown,
    oninput: onInputChange,
  });

  const listItems =
    mode === 'awaiting-option' && pending?.options
      ? pending.options.map((opt, i) =>
          h(
            'div',
            {
              className: 'palette-option' + (i === optIdx ? ' selected' : ''),
            },
            opt.label
          )
        )
      : filtered.map((action, i) =>
          h(
            'div',
            { className: 'palette-item' + (i === selIdx ? ' selected' : '') },
            action.label
          )
        );

  /** @type {any[]} */
  const extras = [];
  if (mode === 'awaiting-input' && pending) {
    const placeholder = pending.input?.placeholder ?? '';
    /** @param {any} ev */
    const onArgKeydown = (ev) => {
      const curPending = state.pendingAction.get();
      if (ev.key === 'Enter') {
        ev.preventDefault?.();
        if (!curPending) return;
        curPending.handler(ev.target.value);
        state.reset();
      } else if (ev.key === 'Escape') {
        ev.preventDefault?.();
        state.reset();
      }
    };
    extras.push(
      h('input', {
        className: 'palette-arg-input',
        type: 'text',
        placeholder,
        onkeydown: onArgKeydown,
      })
    );
  }

  return h(
    'div',
    { className: 'palette-overlay' },
    inputEl,
    ...listItems,
    ...extras
  );
}

export class CRCommandPalette extends ShellElement {
  constructor() {
    super();
    this._state = createCommandPaletteState();
    /** @type {(() => void) | null} */
    this._unbindShortcut = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this._unbindShortcut = bindCommandPaletteShortcut(document);
  }

  disconnectedCallback() {
    this._unbindShortcut?.();
    this._unbindShortcut = null;
    super.disconnectedCallback();
  }

  _render() {
    const content = this.render();
    if (content !== undefined) {
      if (Array.isArray(content)) {
        this.replaceChildren(...content);
      } else {
        this.replaceChildren(content);
      }
    } else {
      this.replaceChildren();
    }
  }

  render() {
    return CommandPalette(this._state);
  }

  /** @param {PaletteAction} action */
  _activateAction(action) {
    this._state.activateAction(action);
  }

  _reset() {
    this._state.reset();
  }
}

customElements.define('cr-command-palette', CRCommandPalette);
