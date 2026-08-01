// @ts-check
// Store-driven Action Centre view and effects.
import { h } from '../../lib/html.js';
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

/** @typedef {import('../../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../../services/action-centre-model.js').Reason} Reason */

export const PAGE_SIZE = 4;

/**
 * The per-Case-Type Action Centre cadences are looked up by `CaseRow.caseType`,
 * which holds the registry slug — the same string `CaseSource.slug` carries —
 * and an unmatched key resolves silently to the framework default.
 *
 * @param {import('../../services/permissions.js').Capabilities} capabilities
 * @param {import('../../setup/resolve-eligible-case-types.js').CaseSource[]} caseSources
 * @param {Date} [now]
 */
export function initialActionCentreState(
  capabilities,
  caseSources,
  now = new Date()
) {
  const allReasons = reasonsForCapabilities(capabilities);
  return {
    slaDays: Object.fromEntries(
      caseSources.map((s) => [s.slug, s.actionCentreSlaDays])
    ),
    allReasons,
    reasons: visibleReasons(allReasons, true),
    counts: /** @type {Record<string, number>} */ ({}),
    headline: 0,
    peeks: /** @type {Record<string, CaseRow | null>} */ ({}),
    expanded: new Set(),
    pages: /** @type {Record<string, CaseRow[]>} */ ({}),
    needsActionNow: true,
    now,
  };
}

/**
 * @param {{
 *   client: import('../../sharepoint-client.js').SharePointClient,
 *   sources: import('../../setup/resolve-eligible-case-types.js').CaseSource[],
 *   reasons: Reason[], currentUserId: string,
 * }} input
 */
export async function loadActionCentreCounts({
  client,
  sources,
  reasons,
  currentUserId,
}) {
  /** @type {Record<string, number>} */
  const counts = {};
  /** @type {Record<string, CaseRow | null>} */
  const peeks = {};
  await Promise.all(
    reasons.map(async (reason) => {
      const filter = activeFilter(reason, currentUserId);
      counts[reason.id] = await countCasesAcrossSources(
        client,
        sources,
        filter
      );
      const perSource = await listCasesPerSource(client, sources, filter, {
        ...worstFirstOrder(reason),
        top: 1,
      });
      peeks[reason.id] = pickGlobalWorst(
        perSource.map(({ rows }) => rows[0] ?? null),
        reason
      );
    })
  );
  const headline = await countCasesAcrossSources(
    client,
    sources,
    headlineFilter(reasons, currentUserId)
  );
  return { counts, peeks, headline };
}

/**
 * @param {{
 *   client: import('../../sharepoint-client.js').SharePointClient,
 *   sources: import('../../setup/resolve-eligible-case-types.js').CaseSource[],
 *   reason: Reason, currentUserId: string, skip: number,
 * }} input
 */
export async function loadActionCentrePage({
  client,
  sources,
  reason,
  currentUserId,
  skip,
}) {
  const perSource = await listCasesPerSource(
    client,
    sources,
    activeFilter(reason, currentUserId),
    { ...worstFirstOrder(reason), top: skip + PAGE_SIZE }
  );
  const rows = mergeWorstFirstWindow(
    perSource.map(({ rows: sourceRows }) => sourceRows),
    reason,
    skip,
    PAGE_SIZE
  );
  return { rows, exhausted: rows.length < PAGE_SIZE };
}

/** @param {number} count */
function caseWord(count) {
  return `${count} case${count === 1 ? '' : 's'}`;
}

/**
 * @param {CaseRow} row @param {Reason} reason @param {Date} now
 * @param {Record<string, Record<string, number> | undefined>} slaDays
 * @param {(row: CaseRow) => void} onOpenCase
 */
function rowView(row, reason, now, slaDays, onOpenCase) {
  const wait = waitingInfo(
    row,
    reason,
    now,
    slaDays[row.caseType]?.[reason.id]
  );
  const secondary = secondaryReasons(row, reason.id);
  const subline = reason.subLine(row);
  const also = secondary.length
    ? `${subline ? ' · ' : ''}also ${secondary.map((item) => item.label).join(', ')}`
    : '';
  return h(
    'li',
    { className: 'cora-ac-row' },
    h(
      'div',
      { className: 'cora-ac-row-main' },
      h(
        'a',
        { className: 'cora-ac-row-ref', href: caseRouteFor(row) },
        row.title || row.id
      ),
      h('div', { className: 'cora-ac-row-sub' }, `${subline}${also}`)
    ),
    h('span', { className: 'cora-ac-chip' }, row.caseType),
    h(
      'span',
      {
        className: wait.breached
          ? `cora-ac-wait cora-ac-wait--${reason.tone}`
          : 'cora-ac-wait',
      },
      wait.label
    ),
    h(
      'button',
      {
        type: 'button',
        className: 'cora-ac-open',
        'aria-label': `Open ${row.title || row.id}`,
        onclick: () => onOpenCase(row),
      },
      'Open'
    )
  );
}

/**
 * @param {Reason} reason @param {ReturnType<typeof initialActionCentreState>} state
 * @param {ActionCentreHandlers} handlers
 */
function groupView(reason, state, handlers) {
  const count = state.counts[reason.id] ?? 0;
  const open = state.expanded.has(reason.id);
  const rows = state.pages[reason.id] ?? [];
  const peek = state.peeks[reason.id];
  const remaining = count - rows.length;
  return h(
    'section',
    { className: 'cora-ac-group', 'data-reason': reason.id },
    h(
      'button',
      {
        type: 'button',
        className: 'cora-ac-group-header',
        'aria-expanded': String(open),
        onclick: () => handlers.onToggleGroup(reason),
      },
      h(
        'span',
        { className: 'cora-ac-caret', 'aria-hidden': 'true' },
        open ? '▾' : '▸'
      ),
      h('span', {
        className: `cora-ac-dot cora-ac-dot--${reason.tone}`,
        'aria-hidden': 'true',
      }),
      h('span', { className: 'cora-ac-group-label' }, reason.label),
      h(
        'span',
        { className: `cora-ac-count cora-ac-count--${reason.tone}` },
        String(count)
      ),
      !open && peek
        ? h(
            'span',
            { className: 'cora-ac-peek' },
            'longest: ',
            h('strong', {}, peek.title || peek.id),
            ` · ${
              waitingInfo(
                peek,
                reason,
                state.now,
                state.slaDays[peek.caseType]?.[reason.id]
              ).label
            }`
          )
        : null
    ),
    open
      ? h(
          'ul',
          { className: 'cora-ac-rows' },
          ...rows.map((row) =>
            rowView(row, reason, state.now, state.slaDays, handlers.onOpenCase)
          ),
          remaining > 0
            ? h(
                'li',
                { className: 'cora-ac-more-row' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'cora-ac-more',
                    onclick: () => handlers.onShowMore(reason),
                  },
                  `Show ${remaining} more ${reason.label.toLowerCase()} →`
                )
              )
            : null
        )
      : null
  );
}

/**
 * @typedef {{
 *   onToggleNeedsAction: (value: boolean) => void,
 *   onToggleGroup: (reason: Reason) => void,
 *   onShowMore: (reason: Reason) => void,
 *   onOpenCase: (row: CaseRow) => void,
 * }} ActionCentreHandlers
 */

/**
 * Pure descriptor-driven reason-list view. Reason definitions and flag
 * behaviour stay owned by `action-centre-model.js`.
 *
 * @param {ReturnType<typeof initialActionCentreState>} state
 * @param {ActionCentreHandlers} handlers
 */
export function ActionCentreView(state, handlers) {
  const empty = state.reasons.every(
    (reason) => (state.counts[reason.id] ?? 0) === 0
  );
  return h(
    'section',
    { className: 'cora-action-centre' },
    h(
      'div',
      { className: 'cora-ac-header' },
      h('h2', { className: 'cora-ac-title' }, 'Action Centre'),
      h(
        'span',
        { className: 'cora-ac-subtitle' },
        `${caseWord(state.headline)} · grouped by reason`
      ),
      h(
        'div',
        {
          className: 'cora-ac-toggle',
          role: 'group',
          'aria-label': 'Worklist scope',
        },
        h(
          'button',
          {
            type: 'button',
            className: state.needsActionNow
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
            className: !state.needsActionNow
              ? 'cora-ac-toggle-btn cora-ac-toggle-btn--on'
              : 'cora-ac-toggle-btn',
            'aria-pressed': String(!state.needsActionNow),
            onclick: () => handlers.onToggleNeedsAction(false),
          },
          'All'
        )
      )
    ),
    empty
      ? EmptyState('Nothing needs your action right now.', {
          className: 'cora-ac-empty',
        })
      : state.reasons.map((reason) => groupView(reason, state, handlers))
  );
}
