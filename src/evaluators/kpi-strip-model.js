// @ts-check
import { isOverdue } from './overdue-evaluator.js';
import { permissions } from '../services/permissions.js';
import { CASE_STATUS } from '../lib/case-statuses.js';
import {
  listCasesAcrossSources,
  countCasesAcrossSources,
} from '../services/across-sources.js';

/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../services/permissions.js').Capabilities} Capabilities */
/** @typedef {import('../services/permissions.js').PermissionsConfig} PermissionsConfig */
/** @typedef {import('../setup/resolve-eligible-case-types.js').CaseSource} CaseSource */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @typedef {{ label: string, count: number }} BreakdownRow
 *
 * A tile's progressive-disclosure detail. `caseType` splits the tile's cases by
 * Case Type (used when the role sees more than one); `reason` splits a single
 * Case Type by sub-reason (an Owner's "At risk" → overdue vs breaching).
 * @typedef {{ axis: 'caseType' | 'reason', rows: BreakdownRow[] }} Breakdown
 *
 * @typedef {{
 * key: string,
 * label: string,
 * tone: string,
 * count: number,
 * defaultExpanded: boolean,
 * breakdown: Breakdown | null
 * }} KpiTile
 *
 * @typedef {{
 * role: 'reviewer' | 'controls' | 'owner',
 * label: string,
 * scopeLabel: string,
 * isPrimary: boolean,
 * defaultOpen: boolean,
 * totalItems: number,
 * tiles: KpiTile[]
 * }} KpiLane
 *
 * @typedef {{ label: string, matches: (caseRow: CaseRow) => boolean }} SubReason
 *
 * @typedef {{ key: string, label: string, tone: string, matched: CaseRow[], subReasons?: SubReason[] }} TileSpec
 */

/**
 * Resolve a Case Type slug to its human display name. Falls
 * back to a title-cased slug for Case Types not present in the permissions
 * config, so the strip degrades gracefully rather than showing a raw slug.
 *
 * @param {string} slug
 * @param {PermissionsConfig} [config]
 * @returns {string}
 */
export function caseTypeDisplayName(slug, config = permissions) {
  const found = config.caseTypes.find((c) => c.slug === slug);
  if (found) return found.displayName;
  return String(slug)
    .split('-')
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ');
}

/**
 * Whether a Case is due within the next 24 hours but not yet overdue. Completed
 * and dateless Cases never breach. `now` is injectable for testing.
 *
 * @param {CaseRow} caseRow
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isBreachingWithin24h(caseRow, now = new Date()) {
  if (caseRow.status === CASE_STATUS.COMPLETED) return false;
  const due = caseRow.dueDate;
  if (!due) return false;
  const dueMs = new Date(due).getTime();
  const nowMs = now.getTime();
  return dueMs >= nowMs && dueMs < nowMs + DAY_MS;
}

/**
 * The author of the last Conversation message on a Case, or null when the
 * Conversation is empty. Used to detect a Reviewer waiting on the Responsible
 * Party (the last word was the Reviewer's).
 *
 * @param {CaseRow} caseRow
 * @returns {string | null}
 */
function lastMessageAuthor(caseRow) {
  const conversation = caseRow.conversation ?? [];
  return conversation.length
    ? conversation[conversation.length - 1].author
    : null;
}

/**
 * Join Case Type slugs into a display scope label ("Complaints, Conduct").
 *
 * @param {string[]} slugs
 * @returns {string}
 */
function scopeLabelOf(slugs) {
  return slugs.map((slug) => caseTypeDisplayName(slug)).join(', ');
}

/**
 * Build a single tile from its matched Cases. The headline `count` is deduped by
 * Case. The breakdown axis is decided by data (the architecture decision spirit — applicability
 * is data): split by Case Type when the matched Cases span more than one,
 * otherwise fall back to the tile's sub-reasons. Zero rows are suppressed.
 *
 * @param {TileSpec & { expandByDefault: boolean }} spec
 * @returns {KpiTile}
 */
function buildTile({ key, label, tone, matched, subReasons, expandByDefault }) {
  const count = new Set(matched.map((c) => c.id)).size;
  const distinctTypes = [...new Set(matched.map((c) => c.caseType))];

  /** @type {Breakdown | null} */
  let breakdown = null;
  if (distinctTypes.length > 1) {
    /** @type {Map<string, number>} */
    const counts = new Map();
    for (const c of matched)
      counts.set(c.caseType, (counts.get(c.caseType) ?? 0) + 1);
    const rows = [...counts.entries()]
      .map(([slug, n]) => ({ label: caseTypeDisplayName(slug), count: n }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    breakdown = { axis: 'caseType', rows };
  } else if (subReasons && subReasons.length) {
    const rows = subReasons
      .map((sr) => ({
        label: sr.label,
        count: matched.filter(sr.matches).length,
      }))
      .filter((row) => row.count > 0);
    if (rows.length) breakdown = { axis: 'reason', rows };
  }

  return {
    key,
    label,
    tone,
    count,
    defaultExpanded: expandByDefault && breakdown != null,
    breakdown,
  };
}

/**
 * Assemble a lane from its tile specs. `totalItems` is the folded-headline count:
 * the union of every tile's matched Cases, deduped by Case.
 *
 * @param {{
 * role: 'reviewer' | 'controls' | 'owner',
 * label: string,
 * scopeLabel: string,
 * specs: TileSpec[],
 * expandTiles: boolean
 * }} args
 * @returns {KpiLane}
 */
function assembleLane({ role, label, scopeLabel, specs, expandTiles }) {
  /** @type {Set<string>} */
  const union = new Set();
  for (const spec of specs) for (const c of spec.matched) union.add(c.id);

  return {
    role,
    label,
    scopeLabel,
    isPrimary: false,
    defaultOpen: true,
    totalItems: union.size,
    tiles: specs.map((spec) =>
      buildTile({ ...spec, expandByDefault: expandTiles })
    ),
  };
}

/**
 * @param {{ client: SharePointClient, currentUserId: string, caseSources: CaseSource[], now: Date }} ctx
 * @returns {Promise<KpiLane>}
 */
async function buildReviewerLane({ client, currentUserId, caseSources, now }) {
  // Each source is a distinct list, already scoped by eligibility; fan out and
  // flatten rather than fetching unscoped and filtering in JS (issue: no
  // default Case list — every read carries an explicit `listName`, and a Case
  // lives in exactly one list, so per-list pools simply flatten together).
  const pool = await listCasesAcrossSources(client, caseSources, {
    status: CASE_STATUS.IN_PROGRESS,
    assignedReviewer: currentUserId,
  });

  const overdue = pool.filter((c) => isOverdue(c, undefined, now));
  const awaiting = pool.filter(
    (c) =>
      !isOverdue(c, undefined, now) && lastMessageAuthor(c) === currentUserId
  );
  const inProgress = pool.filter(
    (c) =>
      !isOverdue(c, undefined, now) && lastMessageAuthor(c) !== currentUserId
  );

  return assembleLane({
    role: 'reviewer',
    label: 'As Reviewer',
    scopeLabel: scopeLabelOf(caseSources.map((s) => s.slug)),
    expandTiles: false,
    specs: [
      { key: 'overdue', label: 'Overdue', tone: 'overdue', matched: overdue },
      {
        key: 'awaiting-rp',
        label: 'Awaiting RP',
        tone: 'awaiting',
        matched: awaiting,
      },
      {
        key: 'in-progress',
        label: 'In progress',
        tone: 'progress',
        matched: inProgress,
      },
    ],
  });
}

/**
 * The Controls lane is a single actionable count — open Appeals still to work —
 * so it reads a `$count` bounded by the indexed `HasOpenAppeal` column rather
 * than fetching the whole Completed set to filter in JS (the architecture decision §2: open work
 * never grows with cumulative volume, so this stays under the List View
 * Threshold for the life of the list). Built directly (not via `assembleLane`,
 * which folds a matched-Case array): with only a count there are no rows to
 * split, so the tile carries no breakdown.
 *
 * @param {{ client: SharePointClient, allCaseSources: CaseSource[] }} ctx
 * @returns {Promise<KpiLane>}
 */
async function buildControlsLane({ client, allCaseSources }) {
  const count = await countCasesAcrossSources(client, allCaseSources, {
    hasOpenAppeal: true,
  });

  return {
    role: 'controls',
    label: 'As Controls',
    scopeLabel: 'all case types',
    isPrimary: false,
    defaultOpen: true,
    totalItems: count,
    tiles: [
      {
        key: 'appeals',
        label: 'Appeals to work',
        tone: 'appeals',
        count,
        defaultExpanded: false,
        breakdown: null,
      },
    ],
  };
}

/**
 * @param {{ client: SharePointClient, capabilities: Capabilities, allCaseSources: CaseSource[], now: Date }} ctx
 * @returns {Promise<KpiLane>}
 */
async function buildOwnerLane({ client, capabilities, allCaseSources, now }) {
  const owned = capabilities.ownedCaseTypes;
  // Lead each read with the indexed Case Type + Status columns so the working
  // set is bounded by In-progress work, never the whole (unbounded) Case Type
  // history. The In-progress pool is what the tiles derive from. Each owned
  // slug resolves to its own list via `allCaseSources`; an owned slug with no
  // matching source (stale config) is skipped rather than fetched unscoped.
  const ownedSources = owned.flatMap((caseType) => {
    const source = allCaseSources.find((s) => s.slug === caseType);
    return source ? [source] : [];
  });
  const pool = await listCasesAcrossSources(client, ownedSources, (source) => ({
    caseType: source.slug,
    status: CASE_STATUS.IN_PROGRESS,
  }));

  const atRisk = pool.filter(
    (c) => isOverdue(c, undefined, now) || isBreachingWithin24h(c, now)
  );
  const unassigned = pool.filter((c) => !c.assignedReviewer);

  return assembleLane({
    role: 'owner',
    label: 'As Owner',
    scopeLabel: scopeLabelOf(owned),
    expandTiles: true,
    specs: [
      {
        key: 'at-risk',
        label: 'At risk',
        tone: 'at-risk',
        matched: atRisk,
        subReasons: [
          {
            label: 'Overdue on team',
            matches: (c) => isOverdue(c, undefined, now),
          },
          {
            label: 'Breaching < 24h',
            matches: (c) => isBreachingWithin24h(c, now),
          },
        ],
      },
      {
        key: 'unassigned',
        label: 'Unassigned',
        tone: 'unassigned',
        matched: unassigned,
      },
    ],
  });
}

/**
 * Build the role-scoped KPI strip model for the current user. One
 * lane per role the user holds — Reviewer, Controls, Owner — each with
 * role-scoped tiles whose numbers are actionable counts (accountability), not
 * everything visible (access, the architecture decision). The first lane the user holds is the
 * primary and opens by default; other lanes open too, except a secondary Owner
 * lane which folds to a headline (owners think per Case Type, so their split is
 * tall). All data flows through the `SharePointClient`.
 *
 * @param {{
 * client: SharePointClient | null,
 * currentUserId: string,
 * capabilities: Capabilities,
 * caseSources?: CaseSource[],
 * allCaseSources?: CaseSource[],
 * now?: Date
 * }} args
 * @returns {Promise<KpiLane[]>}
 */
export async function loadKpiModel({
  client,
  currentUserId,
  capabilities,
  caseSources = [],
  allCaseSources = [],
  now = new Date(),
}) {
  if (!client) return [];

  /** @type {KpiLane[]} */
  const lanes = [];
  if (capabilities.isReviewer) {
    lanes.push(
      await buildReviewerLane({
        client,
        currentUserId,
        caseSources,
        now,
      })
    );
  }
  if (capabilities.isControls) {
    lanes.push(await buildControlsLane({ client, allCaseSources }));
  }
  if (capabilities.ownedCaseTypes.length > 0) {
    lanes.push(
      await buildOwnerLane({ client, capabilities, allCaseSources, now })
    );
  }

  const primaryRole = lanes.length ? lanes[0].role : null;
  for (const lane of lanes) {
    lane.isPrimary = lane.role === primaryRole;
    lane.defaultOpen = lane.isPrimary || lane.role !== 'owner';
  }
  return lanes;
}
