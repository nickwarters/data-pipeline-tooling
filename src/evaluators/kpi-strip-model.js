// @ts-check
import { isOverdue } from './overdue-evaluator.js';
import { permissions } from '../services/permissions.js';

/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../services/permissions.js').Capabilities} Capabilities */
/** @typedef {import('../services/permissions.js').PermissionsConfig} PermissionsConfig */

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
 *   key: string,
 *   label: string,
 *   tone: string,
 *   count: number,
 *   defaultExpanded: boolean,
 *   breakdown: Breakdown | null
 * }} KpiTile
 *
 * @typedef {{
 *   role: 'reviewer' | 'controls' | 'owner',
 *   label: string,
 *   scopeLabel: string,
 *   isPrimary: boolean,
 *   defaultOpen: boolean,
 *   totalItems: number,
 *   tiles: KpiTile[]
 * }} KpiLane
 *
 * @typedef {{ label: string, matches: (caseRow: CaseRow) => boolean }} SubReason
 *
 * @typedef {{ key: string, label: string, tone: string, matched: CaseRow[], subReasons?: SubReason[] }} TileSpec
 */

/**
 * Resolve a Case Type slug to its human display name (ADR-0022 naming). Falls
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
  if (caseRow.status === 'Completed') return false;
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
 * A Completed Case Controls still has to work (an open, unresolved Appeal).
 * Reimplemented locally so this pure evaluator does not import a page module.
 *
 * @param {CaseRow} caseRow
 * @returns {boolean}
 */
function hasOpenAppeal(caseRow) {
  return (caseRow.appeals ?? []).some((appeal) => appeal.state !== 'resolved');
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
 * Case. The breakdown axis is decided by data (ADR-0006 spirit — applicability
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
 *   role: 'reviewer' | 'controls' | 'owner',
 *   label: string,
 *   scopeLabel: string,
 *   specs: TileSpec[],
 *   expandTiles: boolean
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
 * @param {{ client: SharePointClient, currentUserId: string, capabilities: Capabilities, eligibleCaseTypes: string[], now: Date }} ctx
 * @returns {Promise<KpiLane>}
 */
async function buildReviewerLane({
  client,
  currentUserId,
  capabilities,
  eligibleCaseTypes,
  now,
}) {
  const scope = capabilities.listAccessCaseTypes.length
    ? capabilities.listAccessCaseTypes
    : eligibleCaseTypes;
  const raw = await client.listCases({
    status: 'In-progress',
    assignedReviewer: currentUserId,
  });
  const pool = raw.filter((c) => scope.includes(c.caseType));

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
    scopeLabel: scopeLabelOf(scope),
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
 * @param {{ client: SharePointClient }} ctx
 * @returns {Promise<KpiLane>}
 */
async function buildControlsLane({ client }) {
  const completed = await client.listCases({ status: 'Completed' });
  const matched = completed.filter(hasOpenAppeal);

  return assembleLane({
    role: 'controls',
    label: 'As Controls',
    scopeLabel: 'all case types',
    expandTiles: false,
    specs: [
      { key: 'appeals', label: 'Appeals to work', tone: 'appeals', matched },
    ],
  });
}

/**
 * @param {{ client: SharePointClient, capabilities: Capabilities, now: Date }} ctx
 * @returns {Promise<KpiLane>}
 */
async function buildOwnerLane({ client, capabilities, now }) {
  const owned = capabilities.ownedCaseTypes;
  const fetched = await Promise.all(
    owned.map((ct) => client.listCases({ caseType: ct }))
  );
  const pool = fetched.flat().filter((c) => c.status === 'In-progress');

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
 * Build the role-scoped KPI strip model for the current user (issue #286). One
 * lane per role the user holds — Reviewer, Controls, Owner — each with
 * role-scoped tiles whose numbers are actionable counts (accountability), not
 * everything visible (access, ADR-0010). The first lane the user holds is the
 * primary and opens by default; other lanes open too, except a secondary Owner
 * lane which folds to a headline (owners think per Case Type, so their split is
 * tall). All data flows through the `SharePointClient` (ADR-0009).
 *
 * @param {{
 *   client: SharePointClient | null,
 *   currentUserId: string,
 *   capabilities: Capabilities,
 *   eligibleCaseTypes?: string[],
 *   now?: Date
 * }} args
 * @returns {Promise<KpiLane[]>}
 */
export async function loadKpiModel({
  client,
  currentUserId,
  capabilities,
  eligibleCaseTypes = [],
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
        capabilities,
        eligibleCaseTypes,
        now,
      })
    );
  }
  if (capabilities.isControls) {
    lanes.push(await buildControlsLane({ client }));
  }
  if (capabilities.ownedCaseTypes.length > 0) {
    lanes.push(await buildOwnerLane({ client, capabilities, now }));
  }

  const primaryRole = lanes.length ? lanes[0].role : null;
  for (const lane of lanes) {
    lane.isPrimary = lane.role === primaryRole;
    lane.defaultOpen = lane.isPrimary || lane.role !== 'owner';
  }
  return lanes;
}
