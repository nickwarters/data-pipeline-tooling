// @ts-check
import { signal, computed } from '../lib/signal.js';

/**
 * @typedef {'simple'|'input'|'options'} PaletteActionKind
 *
 * @typedef {Object} PaletteAction
 * @property {string} id
 * @property {string} label
 * @property {string[]} keywords
 * @property {PaletteActionKind} [kind]
 * @property {{ placeholder?: string }} [input]
 * @property {Array<{ label: string, value: string }>} [options]
 * @property {(value?: string) => void} handler
 */

/** @type {{ get: () => PaletteAction[], set: (v: PaletteAction[]) => void }} */
export const actions = signal(/** @type {PaletteAction[]} */ ([]));

export const isOpen = signal(false);
export const query = signal('');

export const filteredActions = computed(() => filterActions(query.get(), actions.get()));

/** @param {PaletteAction} action */
export function register(action) {
  const current = actions.get();
  const idx = current.findIndex(a => a.id === action.id);
  if (idx >= 0) {
    const next = [...current];
    next[idx] = action;
    actions.set(next);
  } else {
    actions.set([...current, action]);
  }
}

/** @param {string} id */
export function deregister(id) {
  actions.set(actions.get().filter(a => a.id !== id));
}

export function openPalette() { isOpen.set(true); }
export function closePalette() { isOpen.set(false); }

/**
 * @param {string} q
 * @param {PaletteAction[]} list
 * @returns {PaletteAction[]}
 */
export function filterActions(q, list) {
  if (!q) return list;
  const lower = q.toLowerCase();
  return list.filter(a =>
    a.label.toLowerCase().includes(lower) ||
    a.keywords.some(k => k.toLowerCase().includes(lower))
  );
}
