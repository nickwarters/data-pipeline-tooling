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

import { signal, computed } from '../../lib/signal.js';
import { toastMsg, showToast } from '../../lib/toast.js';
import { questionBanks } from './question-bank-source.js';

// The transient toast primitive now lives in lib/toast.js (a framework concern,
// not bank-editor state). Re-exported here so existing store callers are
// unaffected.
export { toastMsg, showToast };

/** @typedef {import('./question-bank-source.js').QuestionBank} QuestionBank */
/** @typedef {import('./question-bank-source.js').DraftQuestion} DraftQuestion */

/**
 * @typedef {{ category: string|null, questionGroup: string|null, showDeprecated: boolean, conditionalOnly: boolean }} Filters
 */

const initial = /** @type {Record<string, QuestionBank>} */ (
  structuredClone(questionBanks)
);

// The bank the curator lands on by default. Derived from the loaded banks (the
// first manifest slug) rather than hardcoded, so retiring a Case Type never
// leaves the store pointing at a slug that no longer exists.
const defaultSlug = Object.keys(initial)[0];

export const cases = signal(
  /** @type {Record<string, QuestionBank>} */ (structuredClone(initial))
);
export const baseline = signal(
  /** @type {Record<string, QuestionBank>} */ (structuredClone(initial))
);
export const activeSlug = signal(/** @type {string} */ (defaultSlug));
export const filters = signal(
  /** @type {Filters} */ ({
    category: null,
    questionGroup: null,
    showDeprecated: true,
    conditionalOnly: false,
  })
);
export const drawerOpen = signal(false);
/**
 * Whether the left rail is surfaced as a pop-over. Only has a visual effect
 * on narrow viewports (half-screen split view); on wide viewports the rail is
 * a static grid column and this flag is inert. See cora-bank-rail.js.
 */
export const railOpen = signal(false);
/**
 * Sample Cases for the impact simulator, keyed by bank slug. Populated by the
 * question-bank route from `SharePointClient.listCases` (read-only); empty
 * until loaded, in which case the drawer shows its empty state.
 *
 * @type {import('../../lib/signal.js').Signal<Record<string, import('./question-bank-simulate.js').SampleCase[]>>}
 */
export const sampleCases = signal({});

// ── Derived ────────────────────────────────────────────────────────────────

export const currentBank = computed(() => cases.get()[activeSlug.get()]);
export const baselineBank = computed(() => baseline.get()[activeSlug.get()]);
export const isDirty = computed(
  () => JSON.stringify(cases.get()) !== JSON.stringify(baseline.get())
);
export const diffCounts = computed(() => {
  let added = 0,
    changed = 0,
    dep = 0;
  const types = cases.get(),
    base = baseline.get();
  for (const slug in types) {
    /** @type {Record<string, DraftQuestion>} */
    const baseIdx = Object.fromEntries(
      (base[slug]?.questions ?? []).map((q) => [q.id, q])
    );
    for (const q of types[slug].questions) {
      const b = baseIdx[q.id];
      if (!b) {
        added++;
        continue;
      }
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
  // This is a non-reactive mutation-broadcast path (not a reactive() render), so
  // it keeps its own focus-key snapshot/restore rather than the shared
  // captureFocus()/restoreFocus() helpers: those gate on the active element
  // being inside a specific root and always re-focus, whereas here we skip
  // re-focusing when the same element is still active to avoid disturbing an
  // untouched input during coarse-grained rebuilds.
  const doc = /** @type {any} */ (globalThis).document;
  const active = doc?.activeElement;
  const focusKey = active?.getAttribute?.('data-focus-key') ?? null;
  const sel =
    focusKey && active && 'selectionStart' in active
      ? [active.selectionStart, active.selectionEnd]
      : null;

  const v = cases.get();
  mutator(v);
  cases.set(v);

  if (focusKey && doc) {
    const found = doc.querySelector(
      `[data-focus-key="${cssEscape(focusKey)}"]`
    );
    if (found && found !== doc.activeElement) {
      found.focus?.();
      if (sel && typeof found.setSelectionRange === 'function') {
        try {
          found.setSelectionRange(sel[0], sel[1]);
        } catch {
          /* not applicable */
        }
      }
    }
  }
}

/**
 * @param {string} slug
 * @param {import('./question-bank-simulate.js').SampleCase[]} list
 */
export function setSampleCases(slug, list) {
  sampleCases.set({ ...sampleCases.get(), [slug]: list });
}

/** @param {Partial<Filters>} patch */
export function setFilters(patch) {
  filters.set({ ...filters.get(), ...patch });
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
  return s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}

/** Test-only: restore signals to their initial state. */
export function _resetStore() {
  cases.set(structuredClone(initial));
  baseline.set(structuredClone(initial));
  activeSlug.set(defaultSlug);
  filters.set({
    category: null,
    questionGroup: null,
    showDeprecated: true,
    conditionalOnly: false,
  });
  drawerOpen.set(false);
  railOpen.set(false);
  toastMsg.set('');
  sampleCases.set({});
}
