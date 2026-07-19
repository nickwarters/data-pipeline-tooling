// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bindCaseReviewTabs,
  buildCaseReviewTabs,
  createCaseReviewNodeRegistry,
  makeHeaderContext,
  makeTabContext,
  updateCaseReviewHeader,
  updateCaseReviewTabs,
} from './helpers/cora-case-review-controllers.js';

// Capability: node registry, tabs, header, and section labels.

test('CaseReviewNodeRegistry: creates and reuses the long-lived page nodes currently cached by CORACaseReview', () => {
  const registry = createCaseReviewNodeRegistry();
  const first = registry.ensure();
  const firstNodes = {
    tabs: first.tabs,
    details: first.details,
    questionsPanel: first.questionsPanel,
    questionList: first.questionList,
    progress: first.progress,
    issues: first.issues,
    remediation: first.remediation,
    summary: first.summary,
    notes: first.notes,
    appeal: first.appeal,
    amendOutcome: first.amendOutcome,
    conversation: first.conversation,
    banner: first.banner,
    conversationToggle: first.conversationToggle,
    header: first.header,
    completeButton: first.completeButton,
  };

  assert.equal(firstNodes.tabs?.tagName, 'CORA-TABS');
  assert.equal(firstNodes.details?.tagName, 'CORA-CASE-DETAILS');
  assert.equal(firstNodes.questionsPanel?.tagName, 'SECTION');
  assert.equal(firstNodes.questionList?.tagName, 'CORA-QUESTION-LIST');
  assert.equal(firstNodes.progress?.tagName, 'CORA-GROUP-PROGRESS');
  assert.equal(firstNodes.issues?.tagName, 'SECTION');
  assert.equal(firstNodes.remediation?.tagName, 'SECTION');
  assert.equal(firstNodes.summary?.tagName, 'CORA-SUMMARY');
  assert.equal(firstNodes.notes?.tagName, 'CORA-NOTES');
  assert.equal(firstNodes.appeal?.tagName, 'CORA-APPEAL');
  assert.equal(firstNodes.amendOutcome?.tagName, 'CORA-AMEND-OUTCOME');
  assert.equal(firstNodes.conversation?.tagName, 'CORA-CONVERSATION');
  assert.equal(firstNodes.banner?.tagName, 'CORA-STATUS-BANNER');
  assert.equal(firstNodes.conversationToggle?.tagName, 'BUTTON');
  assert.equal(
    firstNodes.conversationToggle?.className,
    'cora-conversation-toggle-btn'
  );
  assert.equal(firstNodes.header?.tagName, 'HEADER');
  assert.equal(firstNodes.completeButton?.tagName, 'BUTTON');
  assert.equal(firstNodes.completeButton?.className, 'cora-complete-btn');

  assert.equal(registry.ensure(), registry);
  assert.equal(registry.tabs, firstNodes.tabs);
  assert.equal(registry.details, firstNodes.details);
  assert.equal(registry.questionsPanel, firstNodes.questionsPanel);
  assert.equal(registry.questionList, firstNodes.questionList);
  assert.equal(registry.progress, firstNodes.progress);
  assert.equal(registry.issues, firstNodes.issues);
  assert.equal(registry.remediation, firstNodes.remediation);
  assert.equal(registry.summary, firstNodes.summary);
  assert.equal(registry.notes, firstNodes.notes);
  assert.equal(registry.appeal, firstNodes.appeal);
  assert.equal(registry.amendOutcome, firstNodes.amendOutcome);
  assert.equal(registry.conversation, firstNodes.conversation);
  assert.equal(registry.banner, firstNodes.banner);
  assert.equal(registry.conversationToggle, firstNodes.conversationToggle);
  assert.equal(registry.header, firstNodes.header);
  assert.equal(registry.completeButton, firstNodes.completeButton);
});

test('CaseReviewTabController: maps section access into tabs in the current order', () => {
  const { context } = makeTabContext({
    access: {
      details: 'read-only',
      questions: 'hidden',
      issues: 'edit',
      remediation: 'read-only',
      summary: 'read-only',
      notes: 'hidden',
      appealRequest: 'edit',
      appealReview: 'read-only',
      amendOutcome: 'read-only',
    },
  });

  assert.deepEqual(buildCaseReviewTabs(/** @type {any} */ (context)), [
    { id: 'details', label: 'Details', hidden: false },
    { id: 'questions', label: 'Review', hidden: true },
    { id: 'issues', label: 'Issues', hidden: false },
    { id: 'remediation', label: 'Remediation', hidden: false },
    { id: 'summary', label: 'Summary', hidden: false },
    { id: 'notes', label: 'Notes', hidden: true },
    { id: 'appealRequest', label: 'Appeal', hidden: false },
    { id: 'appealReview', label: 'Appeal Review', hidden: false },
    { id: 'amendOutcome', label: 'Amend Outcome', hidden: false },
  ]);
});

test('updateCaseReviewTabs: assigns selected tab and panel nodes', () => {
  const { context, tabs, nodes } = makeTabContext({ activeTab: 'summary' });

  updateCaseReviewTabs(/** @type {any} */ (context));

  assert.equal(/** @type {any} */ (tabs).selected, 'summary');
  assert.deepEqual(
    /** @type {any} */ (tabs).tabs.map(
      (/** @type {any} */ tab) => `${tab.id}:${tab.label}:${tab.hidden}`
    ),
    [
      'details:Details:false',
      'questions:Review:false',
      'issues:Issues:false',
      'remediation:Remediation:true',
      'summary:Summary:false',
      'notes:Notes:false',
      'appealRequest:Appeal:true',
      'appealReview:Appeal Review:true',
      'amendOutcome:Amend Outcome:true',
    ]
  );
  assert.deepEqual(/** @type {any} */ (tabs).panels, {
    details: nodes.details,
    questions: nodes.questionsPanel,
    issues: nodes.issues,
    remediation: nodes.remediation,
    summary: nodes.summary,
    notes: nodes.notes,
    appealRequest: nodes.appeal,
    appealReview: nodes.appealReview,
    amendOutcome: nodes.amendOutcome,
  });
});

test('bindCaseReviewTabs: forwards cora-tab-change ids to activeTab', () => {
  const { context, tabs, activeTabSets } = makeTabContext();

  bindCaseReviewTabs(/** @type {any} */ (context));
  tabs._listeners['cora-tab-change'][0]({ detail: { id: 'notes' } });

  assert.deepEqual(activeTabSets, ['notes']);
});

test('updateCaseReviewHeader: preserves title, reviewer, conversation toggle placement, and banner wiring', () => {
  const { context, header, banner, toggle, saveQueue } = makeHeaderContext();

  updateCaseReviewHeader(/** @type {any} */ (context));

  assert.equal(/** @type {any} */ (banner).saveQueue, saveQueue);
  assert.equal(header._children.length, 3);
  assert.equal(header._children[0].textContent, 'Case One');
  assert.equal(header._children[1].textContent, 'Reviewer: Alex Reviewer');
  assert.equal(header._children[2], toggle);
});

test('updateCaseReviewHeader: omits the conversation toggle when the machine disallows it', () => {
  const { context, header, toggle } = makeHeaderContext({
    canToggleConversation: false,
  });

  updateCaseReviewHeader(/** @type {any} */ (context));

  assert.equal(header._children.length, 2);
  assert.ok(
    !header._children.includes(
      /** @type {import('./_dom-stub.js').StubEl} */ (toggle)
    )
  );
});

test('updateCaseReviewHeader: tolerates a missing conversation toggle node', () => {
  const { context, header } = makeHeaderContext({ toggle: null });

  updateCaseReviewHeader(/** @type {any} */ (context));

  assert.equal(header._children.length, 2);
  assert.equal(header._children[0].textContent, 'Case One');
  assert.equal(header._children[1].textContent, 'Reviewer: Alex Reviewer');
});

test('buildCaseReviewTabs: a config sectionLabels override renames its tab, others keep defaults', () => {
  const { context } = makeTabContext();
  /** @type {any} */ (context.viewModel).config = {
    sectionLabels: { questions: 'Assessment' },
  };

  const tabs = buildCaseReviewTabs(/** @type {any} */ (context));

  assert.equal(tabs.find((t) => t.id === 'questions')?.label, 'Assessment');
  assert.equal(tabs.find((t) => t.id === 'details')?.label, 'Details');
  assert.equal(
    tabs.find((t) => t.id === 'appealReview')?.label,
    'Appeal Review'
  );
});

test('buildCaseReviewTabs: prefers the view model resolved sectionLabels when present', () => {
  const { context } = makeTabContext();
  /** @type {any} */ (context.viewModel).sectionLabels = {
    details: 'Details',
    questions: 'Assessment',
    issues: 'Issues',
    remediation: 'Remediation',
    summary: 'Summary',
    notes: 'Notes',
    appealRequest: 'Appeal',
    appealReview: 'Appeal Review',
    amendOutcome: 'Amend Outcome',
    conversation: 'Conversation',
  };

  const tabs = buildCaseReviewTabs(/** @type {any} */ (context));

  assert.equal(tabs.find((t) => t.id === 'questions')?.label, 'Assessment');
  assert.equal(tabs.find((t) => t.id === 'notes')?.label, 'Notes');
});
