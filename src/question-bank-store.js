// @ts-check
/**
 * Reactive state store for the Question Bank curator workbench.
 *
 * The store is a module-level singleton (mirrors the shape the page had as
 * an inline script). Components import the signals they care about and the
 * `commit()` / `setFilters()` / `showToast()` helpers for mutations.
 *
 * commit() preserves focus across re-renders. Coarse-grained reactivity tears
 * down + rebuilds DOM on every signal change, which would steal focus from
 * an actively-typed input. The fix: any input that wants focus survival sets
 * `data-focus-key="<stable>"`, and commit() captures+restores both focus and
 * selection around the mutation.
 */

import { signal, computed } from './signal.js';
import { questionBanks } from '../dev/fixtures/question-banks.js';

/** @typedef {import('../dev/fixtures/question-banks.js').QuestionBank} QuestionBank */
/** @typedef {import('../dev/fixtures/question-banks.js').DraftQuestion} DraftQuestion */

/**
 * @typedef {{ category: string|null, showDeprecated: boolean, conditionalOnly: boolean }} Filters
 */

const initial = /** @type {Record<string, QuestionBank>} */ (structuredClone(questionBanks));

export const cases      = signal(/** @type {Record<string, QuestionBank>} */ (structuredClone(initial)));
export const baseline   = signal(/** @type {Record<string, QuestionBank>} */ (structuredClone(initial)));
export const activeSlug = signal(/** @type {string} */ ('hello-review'));
export const filters    = signal(/** @type {Filters} */ ({ category: null, showDeprecated: true, conditionalOnly: false }));
export const drawerOpen = signal(false);
export const toastMsg   = signal('');

// ── Derived ────────────────────────────────────────────────────────────────

export const currentBank  = computed(() => cases.get()[activeSlug.get()]);
export const baselineBank = computed(() => baseline.get()[activeSlug.get()]);
export const isDirty      = computed(() => JSON.stringify(cases.get()) !== JSON.stringify(baseline.get()));
export const diffCounts   = computed(() => {
  let added = 0, changed = 0, dep = 0;
  const types = cases.get(), base = baseline.get();
  for (const slug in types) {
    /** @type {Record<string, DraftQuestion>} */
    const baseIdx = Object.fromEntries((base[slug]?.questions ?? []).map(q => [q.id, q]));
    for (const q of types[slug].questions) {
      const b = baseIdx[q.id];
      if (!b) { added++; continue; }
      if (!b.deprecated && q.deprecated) dep++;
      else if (JSON.stringify(b) !== JSON.stringify(q)) changed++;
    }
  }
  return { added, changed, deprecated: dep };
});

// ── Mutations ──────────────────────────────────────────────────────────────

/**
 * Mutate `cases` in place then re-emit so subscribed effects fire.
 * Preserves focus/selection across the resulting DOM rebuild for inputs that
 * carry a stable `data-focus-key` attribute.
 *
 * @param {(types: Record<string, QuestionBank>) => void} mutator
 */
export function commit(mutator) {
  const doc = /** @type {any} */ (globalThis).document;
  const active = doc?.activeElement;
  const focusKey = active?.getAttribute?.('data-focus-key') ?? null;
  const sel = (focusKey && active && 'selectionStart' in active)
    ? [active.selectionStart, active.selectionEnd] : null;

  const v = cases.get();
  mutator(v);
  cases.set(v);

  if (focusKey && doc) {
    const found = doc.querySelector(`[data-focus-key="${cssEscape(focusKey)}"]`);
    if (found && found !== doc.activeElement) {
      found.focus?.();
      if (sel && typeof found.setSelectionRange === 'function') {
        try { found.setSelectionRange(sel[0], sel[1]); } catch { /* not applicable */ }
      }
    }
  }
}

/** @param {Partial<Filters>} patch */
export function setFilters(patch) {
  filters.set({ ...filters.get(), ...patch });
}

/** @param {string} msg */
export function showToast(msg) {
  toastMsg.set(msg);
  const timer = /** @type {any} */ (globalThis).setTimeout;
  if (typeof timer === 'function') {
    timer(() => { if (toastMsg.get() === msg) toastMsg.set(''); }, 1800);
  }
}

/**
 * CSS.escape isn't available in every test environment; fall back to a
 * conservative escape that quotes anything outside ASCII alphanumerics, dash,
 * and underscore.
 *
 * @param {string} s
 * @returns {string}
 */
function cssEscape(s) {
  const native = /** @type {any} */ (globalThis).CSS;
  if (native && typeof native.escape === 'function') return native.escape(s);
  return s.replace(/[^a-zA-Z0-9_-]/g, c => `\\${c}`);
}

/** Test-only: restore signals to their initial state. */
export function _resetStore() {
  cases.set(structuredClone(initial));
  baseline.set(structuredClone(initial));
  activeSlug.set('hello-review');
  filters.set({ category: null, showDeprecated: true, conditionalOnly: false });
  drawerOpen.set(false);
  toastMsg.set('');
}
