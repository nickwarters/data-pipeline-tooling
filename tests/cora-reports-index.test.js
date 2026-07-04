// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, StubEl } from './_dom-stub.js';

installDom();

// ===== IMPORTS (after stubs) =====
const { ReportsIndexPage } = await import('../src/pages/cora-reports-index.js');

/** @returns {import('../src/services/permissions.js').Capabilities} */
function managerCaps() {
  return {
    isReviewer: false,
    ownedCaseTypes: [],
    isAdviser: false,
    isReviewerManager: true,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    listAccessCaseTypes: [],
    ownedJourneyCaseTypes: [],
    isControls: false,
    isVisitor: false,
  };
}

/** @returns {import('../src/services/permissions.js').Capabilities} */
function nonManagerCaps() {
  return {
    isReviewer: false,
    ownedCaseTypes: [],
    isAdviser: false,
    isReviewerManager: false,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    listAccessCaseTypes: [],
    ownedJourneyCaseTypes: [],
    isControls: false,
    isVisitor: false,
  };
}

/** @param {any} node @param {string} text @returns {boolean} */
function hasText(node, text) {
  if (typeof node.textContent === 'string' && node.textContent.includes(text))
    return true;
  for (const c of node._children ?? []) {
    if (hasText(c, text)) return true;
  }
  return false;
}

/** @param {any} node @param {string} href @returns {any|null} */
function findLink(node, href) {
  if (node.tagName === 'A' && node.href === href) return node;
  for (const c of node._children ?? []) {
    const found = findLink(c, href);
    if (found) return found;
  }
  return null;
}

/** @param {Node[]} nodes @returns {StubEl} */
function wrapNodes(nodes) {
  const root = new StubEl();
  root.append(.../** @type {StubEl[]} */ (/** @type {unknown} */ (nodes)));
  return root;
}

test('ReportsIndexPage: reviewer manager sees Reviewer Team Performance card', () => {
  const root = wrapNodes(ReportsIndexPage({ capabilities: managerCaps() }));
  assert.ok(
    hasText(root, 'Reviewer Team Performance'),
    'should render card title'
  );
});

test('ReportsIndexPage: reviewer manager card links to #/reports/reviewer-team', () => {
  const root = wrapNodes(ReportsIndexPage({ capabilities: managerCaps() }));
  const link = findLink(root, '#/reports/reviewer-team');
  assert.ok(link, 'should render link to #/reports/reviewer-team');
});

test('ReportsIndexPage: non-manager sees empty-state message', () => {
  const root = wrapNodes(ReportsIndexPage({ capabilities: nonManagerCaps() }));
  assert.ok(
    hasText(root, "You don't have access to any reports"),
    'should render empty-state'
  );
});

test('ReportsIndexPage: non-manager does not see Reviewer Team Performance card', () => {
  const root = wrapNodes(ReportsIndexPage({ capabilities: nonManagerCaps() }));
  assert.ok(
    !hasText(root, 'Reviewer Team Performance'),
    'should not render card for non-manager'
  );
});
