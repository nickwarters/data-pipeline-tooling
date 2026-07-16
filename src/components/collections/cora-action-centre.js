// @ts-check
import { signal } from '../../lib/signal.js';
import { reactive } from '../../lib/view.js';
import { h } from '../../lib/html.js';
import { trackAsyncTasks } from '../../lib/async-tasks.js';
import { EmptyState } from '../../lib/empty-state.js';
import { caseRouteFor } from '../../lib/case-route-links.js';
import {
  listCasesPerSource,
  countCasesAcrossSources,
} from '../../services/across-sources.js';
import {
  reasonsForCapabilities,
  visibleReasons,
  activeFilter,
  headlineFilter,
  worstFirstOrder,
  waitingInfo,
  secondaryReasons,
  pickGlobalWorst,
  mergeWorstFirstWindow,
} from '../../services/action-centre-model.js';

/** @typedef {import('../../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../../services/permissions.js').Capabilities} Capabilities */
/** @typedef {import('../../services/action-centre-model.js').Reason} Reason */

/**
 * How many rows a group holds per page. "Show N more" fetches the next page, so
 * the DOM holds a page — not the whole backlog.
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
 * reasons: Reason[],
 * counts: Record<string, number>,
 * headline: number,
 * peeks: Record<string, CaseRow | null>,
 * expanded: Set<string>,
 * pages: Record<string, CaseRow[]>,
 * needsActionNow: boolean,
 * now: Date,
 * }} ActionCentreState
 *
 * @typedef {{
 * onToggleNeedsAction: (needsActionNow: boolean) => void,
 * onToggleGroup: (reason: Reason) => void,
 * onShowMore: (reason: Reason) => void,
 * onOpenCase: (row: CaseRow) => void,
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
    ? EmptyState('Nothing needs your action right now.', {
        className: 'cora-ac-empty',
      })
    : state.reasons.map((reason) => Group(reason, state, handlers));

  return h('section', { class: 'cora-action-centre' }, header, body);
}

/**
 * The dashboard **Action Centre** worklist: the per-role dashboard
 * tables merged into one reason-grouped, count-driven, server-paged list.
 *
 * Counts (group headers + deduped headline) come from `countCases`; a group's
 * rows come from paged `listCases`, so the client never holds the whole backlog.
 * The highest-priority reason group auto-expands. Degrades to nothing when the
 * client predates `countCases`.
 *
 * A user's action items can live in any Case source, so every read fans out
 * across `allCaseSources`, each carrying its own explicit `{ listName }`
 * (there is no default list). Per-list counts are summed (a Case lives in
 * exactly one list, so no double-count risk); the collapsed-group peek and a
 * page's rows are merged worst-first across lists — see
 * `pickGlobalWorst`/`mergeWorstFirstWindow` in `action-centre-model.js` for the
 * merge order and its correctness argument.
 *
 * @param {{
 * client: SharePointClient | null,
 * capabilities: Capabilities,
 * currentUserId?: string,
 * allCaseSources?: import('../../setup/resolve-eligible-case-types.js').CaseSource[],
 * onOpenCase?: (row: CaseRow) => void,
 * now?: Date,
 * }} props
 * @returns {HTMLElement}
 */
export function ActionCentre({
  client,
  capabilities,
  currentUserId = '',
  allCaseSources = [],
  onOpenCase,
  now = new Date(),
}) {
  /** @type {<T>(task: Promise<T>) => Promise<T>} */
  let track = (task) => task;
  const allReasons = reasonsForCapabilities(capabilities);

  const needsActionNow = signal(true);

  /** Reasons shown under the current toggle (hides the within-SLA tail). */
  const currentReasons = () => visibleReasons(allReasons, needsActionNow.get());
  /** @type {import('../../lib/signal.js').Signal<Record<string, number>>} */
  const counts = signal({});
  const headline = signal(0);
  /** @type {import('../../lib/signal.js').Signal<Record<string, CaseRow | null>>} */
  const peeks = signal({});
  /** @type {import('../../lib/signal.js').Signal<Set<string>>} */
  const expanded = signal(new Set());
  /** @type {import('../../lib/signal.js').Signal<Record<string, CaseRow[]>>} */
  const pages = signal({});

  /**
   * Sum one filter's per-list `countCases` across every Case source.
   * @param {import('../../sharepoint-client.js').ListCasesFilter} filter
   */
  async function sumAcrossSources(filter) {
    const sp = /** @type {SharePointClient} */ (client);
    return countCasesAcrossSources(sp, allCaseSources, filter);
  }

  /** Load every group count, the worst-item peeks, and the deduped headline. */
  async function loadCounts() {
    if (!client) return;
    const reasons = currentReasons();
    const sp = /** @type {SharePointClient} */ (client);
    /** @type {Record<string, number>} */
    const nextCounts = {};
    /** @type {Record<string, CaseRow | null>} */
    const nextPeeks = {};
    await Promise.all(
      reasons.map(async (reason) => {
        const filter = activeFilter(reason, currentUserId);
        nextCounts[reason.id] = await sumAcrossSources(filter);

        // One worst-first row from each list, then the single global worst
        // among those per-list winners (see pickGlobalWorst).
        const perSource = await listCasesPerSource(sp, allCaseSources, filter, {
          ...worstFirstOrder(reason),
          top: 1,
        });
        const perSourceWorst = perSource.map(({ rows }) => rows[0] ?? null);
        nextPeeks[reason.id] = pickGlobalWorst(perSourceWorst, reason);
      })
    );
    headline.set(
      await sumAcrossSources(headlineFilter(reasons, currentUserId))
    );
    counts.set(nextCounts);
    peeks.set(nextPeeks);
  }

  /**
   * Fetch one page of a group's rows, worst-first, across every Case source.
   * `skip === 0` replaces the group's rows (fresh open / toggle); otherwise it
   * appends ("Show N more"). A short final page yields the exact count,
   * correcting any count/page drift.
   *
   * To get the global worst-first window `[skip, skip + PAGE_SIZE)` across N
   * lists, over-fetch worst-first `top: skip + PAGE_SIZE` rows from EACH list
   * (its own top `skip + PAGE_SIZE`, from that list's start — not a
   * continuation of a previous fetch), then merge and re-sort by the same
   * worst-first order and slice the window (`mergeWorstFirstWindow`). This
   * re-fetches an increasing prefix of every list on every page, trading some
   * repeated reads for a global order guarantee regardless of how Cases are
   * distributed across lists; group sizes here are small worklists, not the
   * whole backlog, so the extra reads are cheap. The short-final-page/"corrects
   * the count" behaviour still holds: a merged window shorter than PAGE_SIZE
   * means the true global remainder (summed across all lists) is exhausted.
   *
   * @param {Reason} reason
   * @param {number} skip
   */
  async function loadPage(reason, skip) {
    const sp = /** @type {SharePointClient} */ (client);
    const filter = activeFilter(reason, currentUserId);
    const perSource = await listCasesPerSource(sp, allCaseSources, filter, {
      ...worstFirstOrder(reason),
      top: skip + PAGE_SIZE,
    });
    const rows = mergeWorstFirstWindow(
      perSource.map(({ rows: sourceRows }) => sourceRows),
      reason,
      skip,
      PAGE_SIZE
    );
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
      track(loadPage(reason, 0));
    }
  }

  /** @param {Reason} reason */
  function showMore(reason) {
    track(loadPage(reason, pages.get()[reason.id].length));
  }

  /** @param {boolean} value */
  async function toggleNeedsAction(value) {
    if (needsActionNow.get() === value) return;
    needsActionNow.set(value);
    pages.set({});
    await loadCounts();
    for (const reason of currentReasons()) {
      if (expanded.get().has(reason.id)) track(loadPage(reason, 0));
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
        onToggleNeedsAction: (value) => {
          track(toggleNeedsAction(value));
        },
        onToggleGroup: toggleGroup,
        onShowMore: showMore,
        onOpenCase: (row) => onOpenCase?.(row),
      }
    )
  );
  track = trackAsyncTasks(host);

  async function init() {
    if (!client || typeof client.countCases !== 'function') return;
    await loadCounts();
    const [first] = currentReasons();
    if (first) toggleGroup(first);
  }

  // Defer the first fetch to a microtask so its synchronous signal reads (e.g.
  // `needsActionNow` via currentReasons()) don't run inside — and leak a
  // dependency to — an enclosing render effect such as the dashboard's. Without
  // this, toggling the Action Centre would re-render the whole dashboard and
  // rebuild a fresh Action Centre, discarding the toggle.
  track(Promise.resolve().then(init));
  return host;
}
