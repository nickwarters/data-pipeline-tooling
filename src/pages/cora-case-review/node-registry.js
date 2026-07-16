// @ts-check
import { h } from '../../lib/html.js';
import { SECTION_REGISTRY } from '../../lib/section-registry.js';

/** @typedef {import('./types.js').CaseReviewNodeRegistry} CaseReviewNodeRegistry */
/**
 * The node registry plus its idempotent `ensure()` materializer.
 * @typedef {CaseReviewNodeRegistry & { ensure: () => EnsurableNodeRegistry }} EnsurableNodeRegistry
 */

/**
 * Create the long-lived node registry for a Case Review page instance. The
 * nodes are reused across re-renders so element identity (and the event
 * listeners bound to it) survives a reactive() render pass; `ensure()` is
 * idempotent and returns the registry so a render can lazily materialize the
 * nodes on first paint.
 *
 * This is a plain factory, not a controller class — the Case Review page is a
 * function component (CaseReviewPage) and the panel wiring is a set of plain
 * bind/update functions, so there is no second DOM orchestration layer.
 *
 * @returns {EnsurableNodeRegistry}
 */
export function createCaseReviewNodeRegistry() {
  /** @type {EnsurableNodeRegistry} */
  const registry = {
    tabs: null,
    details: null,
    questionsPanel: null,
    questionList: null,
    progress: null,
    issues: null,
    remediation: null,
    summary: null,
    notes: null,
    appeal: null,
    appealReview: null,
    amendOutcome: null,
    conversation: null,
    banner: null,
    conversationToggle: null,
    header: null,
    completeButton: null,
    ensure() {
      registry.tabs ??= h('cora-tabs');
      // The per-Section panel nodes with a uniform custom-element tag are
      // materialized from the Section registry (ADR-0032) — one source of truth
      // for the id→component wiring. Bespoke nodes (the `questions` panel is a
      // plain <section> wrapping the list + progress) and non-Section chrome
      // (banner, header, buttons) stay hardcoded below.
      for (const entry of SECTION_REGISTRY) {
        if (!entry.componentTag) continue;
        const node = /** @type {Record<string, Element | null>} */ (
          /** @type {unknown} */ (registry)
        );
        node[entry.nodeKey] ??= h(entry.componentTag);
      }
      registry.questionsPanel ??= h('section');
      registry.questionList ??= h('cora-question-list');
      registry.progress ??= h('cora-group-progress');
      registry.banner ??= h('cora-status-banner');
      registry.conversationToggle ??= /** @type {HTMLButtonElement} */ (
        h('button', { class: 'cora-conversation-toggle-btn' })
      );
      registry.header ??= h('header');
      registry.completeButton ??= /** @type {HTMLButtonElement} */ (
        h('button', { class: 'cora-complete-btn' })
      );
      return registry;
    },
  };
  return registry;
}
