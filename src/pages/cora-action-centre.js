// @ts-check
import { signal } from '../lib/signal.js';
import { reactive } from '../lib/view.js';
import { h } from '../lib/html.js';
import { caseRouteFor } from '../lib/case-route-links.js';
import {
  reasonsForCapabilities,
  visibleReasons,
  activeFilter,
  headlineFilter,
  worstFirstOrder,
  waitingInfo,
  secondaryReasons,
} from '../services/action-centre-model.js';

/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../services/permissions.js').Capabilities} Capabilities */
/** @typedef {import('../services/action-centre-model.js').Reason} Reason */

/**
 * How many rows a group holds per page. "Show N more" fetches the next page, so
 * the DOM holds a page — not the whole backlog (issue #287).
 */
export const PAGE_SIZE = 4;

/** @param {CaseRow} row @returns {string} */
function refOf(row) {
  return row.title || row.id;
}

/** @param {number} n @returns {string} */
function caseWord(n) {
  return `${n} case${n === 1 ? '' : 's'}`;
}

/**
 * @typedef {{
 *   reasons: Reason[],
 *   counts: Record<string, number>,
 *   headline: number,
 *   peeks: Record<string, CaseRow | null>,
 *   expanded: Set<string>,
 *   pages: Record<string, CaseRow[]>,
 *   needsActionNow: boolean,
 *   now: Date,
 * }} ActionCentreState
 *
 * @typedef {{
 *   onToggleNeedsAction: (needsActionNow: boolean) => void,
 *   onToggleGroup: (reason: Reason) => void,
 *   onShowMore: (reason: Reason) => void,
 *   onOpenCase: (row: CaseRow) => void,
 * }} ActionCentreHandlers
 */

/**
 * One worklist row: reference link, sub-line (with any secondary-reason note),
 * Case Type chip, the reason's "waiting" age (emphasised once breached), Open.
 *
 * @param {CaseRow} row
 * @param {Reason} reason
 * @param {Date} now
 * @param {(row: CaseRow) => void} onOpenCase
 * @returns {HTMLElement}
 */
function Row(row, reason, now, onOpenCase) {
  const wait = waitingInfo(row, reason, now);
  const secondary = secondaryReasons(row, reason.id);
  const sub = reason.subLine(row);
  const alsoNote = secondary.length
    ? `${sub ? ' · ' : ''}also ${secondary.map((r) => r.label).join(', ')}`
    : '';

  return h(
    'li',
    { class: 'cora-ac-row' },
    h(
      'div',
      { class: 'cora-ac-row-main' },
      h('a', { class: 'cora-ac-row-ref', href: caseRouteFor(row) }, refOf(row)),
      h('div', { class: 'cora-ac-row-sub' }, `${sub}${alsoNote}`)
    ),
    h('span', { class: 'cora-ac-chip' }, row.caseType),
    h(
      'span',
      {
        class: wait.breached
          ? `cora-ac-wait cora-ac-wait--${reason.tone}`
          : 'cora-ac-wait',
      },
      wait.label
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'cora-ac-open',
        'aria-label': `Open ${refOf(row)}`,
        onclick: () => onOpenCase(row),
      },
      'Open'
    )
  );
}

/**
 * One collapsible reason group: a header with the reason dot, label, server-side
 * count and — while collapsed — a one-line peek at the worst item; and, while
 * expanded, its current page of rows plus a "Show N more" pager.
 *
 * @param {Reason} reason
 * @param {ActionCentreState} state
 * @param {ActionCentreHandlers} handlers
 * @returns {HTMLElement}
 */
function Group(reason, state, handlers) {
  // A group revealed by the "All" toggle renders once before its count has
  // loaded, so fall back to 0 rather than flash "undefined".
  const count = state.counts[reason.id] ?? 0;
  const isOpen = state.expanded.has(reason.id);
  const rows = state.pages[reason.id] ?? [];
  const peek = state.peeks[reason.id];

  const header = h(
    'button',
    {
      type: 'button',
      class: 'cora-ac-group-header',
      'aria-expanded': String(isOpen),
      onclick: () => handlers.onToggleGroup(reason),
    },
    h(
      'span',
      { class: 'cora-ac-caret', 'aria-hidden': 'true' },
      isOpen ? '▾' : '▸'
    ),
    h('span', {
      class: `cora-ac-dot cora-ac-dot--${reason.tone}`,
      'aria-hidden': 'true',
    }),
    h('span', { class: 'cora-ac-group-label' }, reason.label),
    h(
      'span',
      { class: `cora-ac-count cora-ac-count--${reason.tone}` },
      String(count)
    ),
    !isOpen && peek
      ? h(
          'span',
          { class: 'cora-ac-peek' },
          'longest: ',
          h('strong', {}, refOf(peek)),
          ` · ${waitingInfo(peek, reason, state.now).label}`
        )
      : null
  );

  const remaining = count - rows.length;
  const body = isOpen
    ? h(
        'ul',
        { class: 'cora-ac-rows' },
        ...rows.map((row) => Row(row, reason, state.now, handlers.onOpenCase)),
        remaining > 0
          ? h(
              'li',
              { class: 'cora-ac-more-row' },
              h(
                'button',
                {
                  type: 'button',
                  class: 'cora-ac-more',
                  onclick: () => handlers.onShowMore(reason),
                },
                `Show ${remaining} more ${reason.label.toLowerCase()} →`
              )
            )
          : null
      )
    : null;

  return h(
    'section',
    { class: 'cora-ac-group', 'data-reason': reason.id },
    header,
    body
  );
}

/**
 * Pure render of the Action Centre from plain state + handlers. No I/O, no
 * signals — the orchestrator feeds it current signal values.
 *
 * @param {ActionCentreState} state
 * @param {ActionCentreHandlers} handlers
 * @returns {HTMLElement}
 */
export function ActionCentreView(state, handlers) {
  const empty = state.reasons.every((r) => (state.counts[r.id] ?? 0) === 0);

  const toggle = h(
    'div',
    { class: 'cora-ac-toggle', role: 'group', 'aria-label': 'Worklist scope' },
    h(
      'button',
      {
        type: 'button',
        class: state.needsActionNow
          ? 'cora-ac-toggle-btn cora-ac-toggle-btn--on'
          : 'cora-ac-toggle-btn',
        'aria-pressed': String(state.needsActionNow),
        onclick: () => handlers.onToggleNeedsAction(true),
      },
      'Needs action now'
    ),
    h(
      'button',
      {
        type: 'button',
        class: !state.needsActionNow
          ? 'cora-ac-toggle-btn cora-ac-toggle-btn--on'
          : 'cora-ac-toggle-btn',
        'aria-pressed': String(!state.needsActionNow),
        onclick: () => handlers.onToggleNeedsAction(false),
      },
      'All'
    )
  );

  const header = h(
    'div',
    { class: 'cora-ac-header' },
    h('h2', { class: 'cora-ac-title' }, 'Action Centre'),
    h(
      'span',
      { class: 'cora-ac-subtitle' },
      `${caseWord(state.headline)} · grouped by reason`
    ),
    toggle
  );

  const body = empty
    ? h('p', { class: 'cora-ac-empty' }, 'Nothing needs your action right now.')
    : state.reasons.map((reason) => Group(reason, state, handlers));

  return h('section', { class: 'cora-action-centre' }, header, body);
}

/**
 * The dashboard **Action Centre** worklist (issue #287): the per-role dashboard
 * tables merged into one reason-grouped, count-driven, server-paged list.
 *
 * Counts (group headers + deduped headline) come from `countCases`; a group's
 * rows come from paged `listCases`, so the client never holds the whole backlog.
 * The highest-priority reason group auto-expands. Degrades to nothing when the
 * client predates `countCases`.
 *
 * @param {{
 *   client: SharePointClient | null,
 *   capabilities: Capabilities,
 *   currentUserId?: string,
 *   onOpenCase?: (row: CaseRow) => void,
 *   now?: Date,
 * }} props
 * @returns {HTMLElement}
 */
export function ActionCentre({
  client,
  capabilities,
  currentUserId = '',
  onOpenCase,
  now = new Date(),
}) {
  const allReasons = reasonsForCapabilities(capabilities);

  const needsActionNow = signal(true);

  /** Reasons shown under the current toggle (hides the within-SLA tail). */
  const currentReasons = () => visibleReasons(allReasons, needsActionNow.get());
  /** @type {import('../lib/signal.js').Signal<Record<string, number>>} */
  const counts = signal({});
  const headline = signal(0);
  /** @type {import('../lib/signal.js').Signal<Record<string, CaseRow | null>>} */
  const peeks = signal({});
  /** @type {import('../lib/signal.js').Signal<Set<string>>} */
  const expanded = signal(new Set());
  /** @type {import('../lib/signal.js').Signal<Record<string, CaseRow[]>>} */
  const pages = signal({});

  /** Load every group count, the worst-item peeks, and the deduped headline. */
  async function loadCounts() {
    if (!client) return;
    const reasons = currentReasons();
    /** @type {Record<string, number>} */
    const nextCounts = {};
    /** @type {Record<string, CaseRow | null>} */
    const nextPeeks = {};
    await Promise.all(
      reasons.map(async (reason) => {
        const filter = activeFilter(reason, currentUserId);
        nextCounts[reason.id] = await client.countCases(filter);
        const [worst] = await client.listCases(filter, {
          ...worstFirstOrder(reason),
          top: 1,
        });
        nextPeeks[reason.id] = worst ?? null;
      })
    );
    headline.set(
      await client.countCases(headlineFilter(reasons, currentUserId))
    );
    counts.set(nextCounts);
    peeks.set(nextPeeks);
  }

  /**
   * Fetch one page of a group's rows, worst-first. `skip === 0` replaces the
   * group's rows (fresh open / toggle); otherwise it appends ("Show N more").
   * A short final page yields the exact count, correcting any count/page drift.
   *
   * @param {Reason} reason
   * @param {number} skip
   */
  async function loadPage(reason, skip) {
    const sp = /** @type {SharePointClient} */ (client);
    const rows = await sp.listCases(activeFilter(reason, currentUserId), {
      ...worstFirstOrder(reason),
      top: PAGE_SIZE,
      skip,
    });
    const current = pages.get();
    const existing = skip === 0 ? [] : current[reason.id];
    const merged = [...existing, ...rows];
    pages.set({ ...current, [reason.id]: merged });
    if (rows.length < PAGE_SIZE) {
      counts.set({ ...counts.get(), [reason.id]: merged.length });
    }
  }

  /** @param {Reason} reason */
  function toggleGroup(reason) {
    const next = new Set(expanded.get());
    if (next.has(reason.id)) {
      next.delete(reason.id);
      expanded.set(next);
    } else {
      next.add(reason.id);
      expanded.set(next);
      loadPage(reason, 0);
    }
  }

  /** @param {Reason} reason */
  function showMore(reason) {
    loadPage(reason, pages.get()[reason.id].length);
  }

  /** @param {boolean} value */
  async function toggleNeedsAction(value) {
    if (needsActionNow.get() === value) return;
    needsActionNow.set(value);
    pages.set({});
    await loadCounts();
    for (const reason of currentReasons()) {
      if (expanded.get().has(reason.id)) loadPage(reason, 0);
    }
  }

  const host = reactive(() =>
    ActionCentreView(
      {
        reasons: currentReasons(),
        counts: counts.get(),
        headline: headline.get(),
        peeks: peeks.get(),
        expanded: expanded.get(),
        pages: pages.get(),
        needsActionNow: needsActionNow.get(),
        now,
      },
      {
        onToggleNeedsAction: toggleNeedsAction,
        onToggleGroup: toggleGroup,
        onShowMore: showMore,
        onOpenCase: (row) => onOpenCase?.(row),
      }
    )
  );

  async function init() {
    if (!client || typeof client.countCases !== 'function') return;
    await loadCounts();
    const [first] = currentReasons();
    if (first) toggleGroup(first);
  }

  init();
  return host;
}
