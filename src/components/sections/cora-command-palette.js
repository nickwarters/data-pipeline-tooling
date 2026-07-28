// @ts-check
import { h } from '../../lib/html.js';
import { render } from '../../core/render.js';
import { filterActions } from '../../services/command-palette-store.js';

/** @typedef {import('../../services/command-palette-store.js').PaletteAction} PaletteAction */
/** @typedef {import('../../services/command-palette-store.js').CommandPaletteState} CommandPaletteState */

/**
 * @param {{ addEventListener(type: string, listener: (event: any) => void): void, removeEventListener(type: string, listener: (event: any) => void): void }} target
 * @param {() => void} open
 * @returns {() => void}
 */
export function bindCommandPaletteShortcut(target, open) {
  /** @param {any} event */
  const onKeydown = (event) => {
    if (event.key === 'k' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault?.();
      open();
    }
  };
  target.addEventListener('keydown', onKeydown);
  return () => target.removeEventListener('keydown', onKeydown);
}

/**
 * Pure command-palette view: state in, action dispatches back.
 * @param {CommandPaletteState} state
 * @param {(action: {type: string, [key: string]: any}) => void} dispatch
 * @returns {HTMLElement | HTMLElement[]}
 */
export function CommandPalette(state, dispatch) {
  if (!state.isOpen) return [];
  const filtered = filterActions(state.query, state.actions);

  /** @param {PaletteAction} action */
  const activate = (action) => {
    if (action.kind === 'input') {
      dispatch({ type: 'palette/await-input', action });
    } else if (action.kind === 'options') {
      dispatch({ type: 'palette/await-option', action });
    } else {
      action.handler();
      dispatch({ type: 'palette/close' });
    }
  };

  /** @param {any} event */
  const onKeydown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault?.();
      dispatch({ type: 'palette/close' });
      return;
    }
    if (state.mode === 'awaiting-option') {
      const options = state.pendingAction?.options ?? [];
      if (event.key === 'ArrowDown') {
        event.preventDefault?.();
        dispatch({
          type: 'palette/select-option',
          index: Math.min(state.optionIndex + 1, options.length - 1),
        });
      } else if (event.key === 'ArrowUp') {
        event.preventDefault?.();
        dispatch({
          type: 'palette/select-option',
          index: Math.max(state.optionIndex - 1, 0),
        });
      } else if (event.key === 'Enter') {
        event.preventDefault?.();
        const option = options[state.optionIndex];
        if (option && state.pendingAction) {
          state.pendingAction.handler(option.value);
          dispatch({ type: 'palette/close' });
        }
      }
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault?.();
      dispatch({
        type: 'palette/select',
        index: Math.min(state.selectedIndex + 1, filtered.length - 1),
      });
    } else if (event.key === 'ArrowUp') {
      event.preventDefault?.();
      dispatch({
        type: 'palette/select',
        index: Math.max(state.selectedIndex - 1, 0),
      });
    } else if (event.key === 'Enter') {
      event.preventDefault?.();
      const action = filtered[state.selectedIndex];
      if (action) activate(action);
    }
  };

  const input = h('input', {
    className: 'palette-input',
    type: 'text',
    placeholder: 'Type a command…',
    value: state.query,
    onkeydown: onKeydown,
    oninput: (/** @type {any} */ event) =>
      dispatch({ type: 'palette/query', query: event.target.value }),
  });

  const items =
    state.mode === 'awaiting-option' && state.pendingAction?.options
      ? state.pendingAction.options.map((option, index) =>
          h(
            'div',
            {
              className:
                'palette-option' +
                (index === state.optionIndex ? ' selected' : ''),
            },
            option.label
          )
        )
      : filtered.map((action, index) =>
          h(
            'div',
            {
              className:
                'palette-item' +
                (index === state.selectedIndex ? ' selected' : ''),
            },
            action.label
          )
        );

  const extra = [];
  if (state.mode === 'awaiting-input' && state.pendingAction) {
    const pending = state.pendingAction;
    extra.push(
      h('input', {
        className: 'palette-arg-input',
        type: 'text',
        placeholder: pending.input?.placeholder ?? '',
        onkeydown: (/** @type {any} */ event) => {
          if (event.key === 'Enter') {
            event.preventDefault?.();
            pending.handler(event.target.value);
            dispatch({ type: 'palette/close' });
          } else if (event.key === 'Escape') {
            event.preventDefault?.();
            dispatch({ type: 'palette/close' });
          }
        },
      })
    );
  }

  return h('div', { className: 'palette-overlay' }, input, ...items, ...extra);
}

/**
 * Mount the pure view against a store and return lifecycle cleanup.
 * @param {Element} container
 * @param {{
 *   store: { getState(): CommandPaletteState, dispatch(action: any): any, subscribe(listener: (state: CommandPaletteState) => void): () => void },
 *   target?: any,
 * }} options
 * @returns {() => void}
 */
export function mountCommandPalette(container, { store, target = document }) {
  const renderPalette = (/** @type {CommandPaletteState} */ state) =>
    render(
      container,
      CommandPalette(state, (action) => store.dispatch(action))
    );
  const unsubscribe = store.subscribe(renderPalette);
  const unbindShortcut = bindCommandPaletteShortcut(target, () =>
    store.dispatch({ type: 'palette/open' })
  );
  renderPalette(store.getState());
  return () => {
    unbindShortcut();
    unsubscribe();
  };
}
