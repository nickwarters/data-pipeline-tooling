// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, findByClass, findAllByClass, flush } from './_dom-stub.js';

installDom();

const { CORAKpiStrip, renderKpiStrip } =
  await import('../src/components/sections/cora-kpi-strip.js');

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */

const NOW = new Date('2026-07-04T12:00:00Z');
const PAST = '2026-07-01T00:00:00Z';
const SOON = '2026-07-04T18:00:00Z';

/**
 * @param {Partial<CaseRow>} [overrides]
 * @returns {CaseRow}
 */
function caseRow(overrides = {}) {
  return {
    id: 'c-' + Math.random().toString(36).slice(2),
    caseType: 'complaints',
    title: 'Case',
    status: 'In-progress',
    assignedReviewer: 'me',
    responsibleParty: 'rp',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: null,
    etag: 'e1',
    ...overrides,
  };
}

function defaultCapabilities(overrides = {}) {
  return {
    isReviewer: false,
    listAccessCaseTypes: [],
    isAdviser: false,
    ownedCaseTypes: [],
    ownedJourneyCaseTypes: [],
    isControls: false,
    isReviewerManager: false,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    isVisitor: false,
    ...overrides,
  };
}

/** @param {(f: any, opts?: any) => CaseRow[]} handler */
function makeClient(handler) {
  return {
    /** @param {any} f @param {any} [opts] */
    async listCases(f, opts) {
      return handler(f, opts).map((c) => ({ ...c }));
    },
  };
}

/**
 * @param {string} slug
 * @param {string} [listName]
 * @returns {import('../src/setup/resolve-eligible-case-types.js').CaseSource}
 */
function source(slug, listName = `Cases-${slug}`) {
  return { slug, listName, displayName: slug };
}

/** @param {any} el */
function textOf(el) {
  return el ? el.textContent : undefined;
}

// ===== Pure render =====

/** @returns {import('../src/evaluators/kpi-strip-model.js').KpiLane} */
function fakeLane(overrides = {}) {
  return {
    role: 'reviewer',
    label: 'As Reviewer',
    scopeLabel: 'Complaints, Conduct',
    isPrimary: true,
    defaultOpen: true,
    totalItems: 6,
    tiles: [
      {
        key: 'overdue',
        label: 'Overdue',
        tone: 'overdue',
        count: 6,
        defaultExpanded: false,
        breakdown: {
          axis: 'caseType',
          rows: [
            { label: 'Complaints', count: 4 },
            { label: 'Conduct', count: 2 },
          ],
        },
      },
      {
        key: 'in-progress',
        label: 'In progress',
        tone: 'progress',
        count: 4,
        defaultExpanded: false,
        breakdown: null,
      },
    ],
    ...overrides,
  };
}

test('renderKpiStrip: renders a lane header with role, scope and open caret', () => {
  const strip = renderKpiStrip({
    lanes: [fakeLane()],
    openLanes: new Set(['reviewer']),
    expandedTiles: new Set(),
    onToggleLane: () => {},
    onToggleTile: () => {},
  });
  assert.equal(strip.className, 'cora-kpi-strip');
  assert.equal(
    textOf(findByClass(strip, 'cora-kpi-lane__role')),
    'As Reviewer'
  );
  assert.equal(
    textOf(findByClass(strip, 'cora-kpi-lane__scope')),
    '· Complaints, Conduct'
  );
  assert.equal(textOf(findByClass(strip, 'cora-kpi-caret')), '▾');
  assert.ok(
    findByClass(strip, 'cora-kpi-lane cora-kpi-lane--primary'),
    'primary lane carries its modifier class'
  );
});

test('renderKpiStrip: folded lane shows a headline item count and no tiles', () => {
  const strip = renderKpiStrip({
    lanes: [fakeLane({ isPrimary: false })],
    openLanes: new Set(),
    expandedTiles: new Set(),
    onToggleLane: () => {},
    onToggleTile: () => {},
  });
  assert.equal(
    textOf(findByClass(strip, 'cora-kpi-lane__scope')),
    '· Complaints, Conduct — 6 items'
  );
  assert.equal(findByClass(strip, 'cora-kpi-tiles'), null);
  assert.equal(textOf(findByClass(strip, 'cora-kpi-caret')), '▸');
});

test('renderKpiStrip: a tile with a breakdown is a toggle button; a plain tile is a div', () => {
  const strip = renderKpiStrip({
    lanes: [fakeLane()],
    openLanes: new Set(['reviewer']),
    expandedTiles: new Set(),
    onToggleLane: () => {},
    onToggleTile: () => {},
  });
  const tiles = findAllByClass(strip, 'cora-kpi-tile cora-kpi-tile--overdue');
  assert.equal(tiles[0].tagName, 'BUTTON');
  assert.equal(tiles[0].getAttribute('aria-expanded'), 'false');

  const plain = findAllByClass(strip, 'cora-kpi-tile cora-kpi-tile--progress');
  assert.equal(plain[0].tagName, 'DIV');
  // no caret on a breakdown-less tile
  assert.equal(findByClass(plain[0], 'cora-kpi-tile__caret'), null);
});

test('renderKpiStrip: expanded caseType tile renders zero-suppressed rows with bars', () => {
  const strip = renderKpiStrip({
    lanes: [fakeLane()],
    openLanes: new Set(['reviewer']),
    expandedTiles: new Set(['reviewer:overdue']),
    onToggleLane: () => {},
    onToggleTile: () => {},
  });
  const rows = findAllByClass(strip, 'cora-kpi-row cora-kpi-row--caseType');
  assert.equal(rows.length, 2);
  assert.equal(
    textOf(findByClass(rows[0], 'cora-kpi-row__label')),
    'Complaints'
  );
  assert.equal(textOf(findByClass(rows[0], 'cora-kpi-row__count')), '4');
  assert.ok(
    findByClass(rows[0], 'cora-kpi-row__bar'),
    'caseType row has a bar'
  );
});

test('renderKpiStrip: expanded reason tile renders label/count rows without bars', () => {
  const reasonLane = fakeLane({
    role: 'owner',
    tiles: [
      {
        key: 'at-risk',
        label: 'At risk',
        tone: 'at-risk',
        count: 4,
        defaultExpanded: true,
        breakdown: {
          axis: 'reason',
          rows: [
            { label: 'Overdue on team', count: 3 },
            { label: 'Breaching < 24h', count: 1 },
          ],
        },
      },
    ],
  });
  const strip = renderKpiStrip({
    lanes: [reasonLane],
    openLanes: new Set(['owner']),
    expandedTiles: new Set(['owner:at-risk']),
    onToggleLane: () => {},
    onToggleTile: () => {},
  });
  const rows = findAllByClass(strip, 'cora-kpi-row cora-kpi-row--reason');
  assert.equal(rows.length, 2);
  assert.equal(findByClass(rows[0], 'cora-kpi-row__bar'), null);
  assert.equal(textOf(findByClass(rows[0], 'cora-kpi-row__count')), '3');
});

test('renderKpiStrip: lane and tile clicks invoke their toggle handlers', () => {
  /** @type {string[]} */
  const laneToggles = [];
  /** @type {string[]} */
  const tileToggles = [];
  const strip = renderKpiStrip({
    lanes: [fakeLane()],
    openLanes: new Set(['reviewer']),
    expandedTiles: new Set(),
    onToggleLane: (r) => laneToggles.push(r),
    onToggleTile: (r, k) => tileToggles.push(`${r}:${k}`),
  });

  findByClass(strip, 'cora-kpi-lane__header')._fire('click', {});
  assert.deepEqual(laneToggles, ['reviewer']);

  findAllByClass(strip, 'cora-kpi-tile cora-kpi-tile--overdue')[0]._fire(
    'click',
    {}
  );
  assert.deepEqual(tileToggles, ['reviewer:overdue']);
});

// ===== Custom element =====

test('CORAKpiStrip: renders nothing when client is missing', async () => {
  const el = new CORAKpiStrip();
  el.capabilities = /** @type {any} */ (
    defaultCapabilities({ isReviewer: true })
  );
  await el.connectedCallback();
  await flush();
  assert.equal(/** @type {any} */ (el)._children.length, 0);
});

test('CORAKpiStrip: renders nothing when capabilities are missing', async () => {
  const el = new CORAKpiStrip();
  el.client = /** @type {any} */ (makeClient(() => []));
  await el.connectedCallback();
  await flush();
  assert.equal(/** @type {any} */ (el)._children.length, 0);
});

test('CORAKpiStrip: a visitor (no lanes) renders nothing', async () => {
  const el = new CORAKpiStrip();
  el.client = /** @type {any} */ (makeClient(() => []));
  el.capabilities = /** @type {any} */ (defaultCapabilities());
  await el.connectedCallback();
  await flush();
  assert.equal(/** @type {any} */ (el)._children.length, 0);
});

test('CORAKpiStrip: fetches, seeds default open/expanded state, and renders the strip', async () => {
  const rows = [
    caseRow({ id: 'l1', caseType: 'lending', dueDate: PAST }),
    caseRow({ id: 'l2', caseType: 'lending', dueDate: SOON }),
    caseRow({ id: 'l3', caseType: 'lending', assignedReviewer: '' }),
  ];
  const el = new CORAKpiStrip();
  el.client = /** @type {any} */ (
    makeClient((f) => rows.filter((r) => r.caseType === f.caseType))
  );
  el.capabilities = /** @type {any} */ (
    defaultCapabilities({ ownedCaseTypes: ['lending'] })
  );
  el.allCaseSources = [source('lending')];
  el.now = NOW;
  await el.connectedCallback();
  await flush();

  const strip = findByClass(el, 'cora-kpi-strip');
  assert.ok(strip, 'strip renders after fetch');
  // Owner-only user: primary lane is open, At risk tile defaults expanded.
  assert.ok(findByClass(el, 'cora-kpi-tiles'), 'lane is open');
  const atRiskRows = findAllByClass(el, 'cora-kpi-row cora-kpi-row--reason');
  assert.equal(atRiskRows.length, 2, 'At risk defaults to its split');
});

test('CORAKpiStrip: clicking a lane header collapses it; clicking again re-opens', async () => {
  const el = new CORAKpiStrip();
  el.client = /** @type {any} */ (
    makeClient(() => [
      caseRow({ id: 'o1', caseType: 'complaints', dueDate: PAST }),
    ])
  );
  el.capabilities = /** @type {any} */ (
    defaultCapabilities({
      isReviewer: true,
      listAccessCaseTypes: ['complaints'],
    })
  );
  el.caseSources = [source('complaints')];
  el.now = NOW;
  await el.connectedCallback();
  await flush();

  assert.ok(findByClass(el, 'cora-kpi-tiles'), 'lane starts open');
  findByClass(el, 'cora-kpi-lane__header')._fire('click', {});
  assert.equal(findByClass(el, 'cora-kpi-tiles'), null, 'lane collapses');
  findByClass(el, 'cora-kpi-lane__header')._fire('click', {});
  assert.ok(findByClass(el, 'cora-kpi-tiles'), 'lane re-opens');
});

test('CORAKpiStrip: clicking a collapsed tile reveals its breakdown, then hides it', async () => {
  const rows = [
    caseRow({ id: 'o1', caseType: 'complaints', dueDate: PAST }),
    caseRow({ id: 'o2', caseType: 'conduct', dueDate: PAST }),
  ];
  const el = new CORAKpiStrip();
  el.client = /** @type {any} */ (makeClient(() => rows));
  el.capabilities = /** @type {any} */ (
    defaultCapabilities({
      isReviewer: true,
      listAccessCaseTypes: ['complaints', 'conduct'],
    })
  );
  el.caseSources = [source('complaints'), source('conduct')];
  el.now = NOW;
  await el.connectedCallback();
  await flush();

  // Reviewer tiles start collapsed.
  assert.equal(findByClass(el, 'cora-kpi-breakdown'), null);
  const overdueTile = findAllByClass(
    el,
    'cora-kpi-tile cora-kpi-tile--overdue'
  )[0];
  overdueTile._fire('click', {});
  assert.ok(
    findByClass(el, 'cora-kpi-breakdown'),
    'breakdown revealed on click'
  );

  findAllByClass(el, 'cora-kpi-tile cora-kpi-tile--overdue')[0]._fire(
    'click',
    {}
  );
  assert.equal(
    findByClass(el, 'cora-kpi-breakdown'),
    null,
    'breakdown hidden again'
  );
});
