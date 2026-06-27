// @ts-check
import assert from 'node:assert/strict';
import test from 'node:test';

class StubEl {
  constructor() {
    /** @type {StubEl[]} */
    this._children = [];
    /** @type {Record<string, string>} */
    this._attrs = {};
    this.textContent = '';
    this.className = '';
    this.tagName = '';
  }
  replaceChildren(/** @type {StubEl[]} */ ...children) {
    this._children = children;
  }
  appendChild(/** @type {StubEl} */ child) {
    this._children.push(child);
    return child;
  }
  setAttribute(/** @type {string} */ key, /** @type {string} */ value) {
    this._attrs[key] = value;
  }
  getAttribute(/** @type {string} */ key) {
    return this._attrs[key] ?? null;
  }
}

/** @type {any} */ (globalThis).HTMLElement = StubEl;
/** @type {any} */ (globalThis).HTMLButtonElement = StubEl;
/** @type {any} */ (globalThis).document = {
  /** @param {string} tag @returns {StubEl} */
  createElement(tag) {
    const el = new StubEl();
    el.tagName = tag.toUpperCase();
    return el;
  },
};

const { CaseReviewHeaderController } =
  await import('../src/pages/cr-case-review/header-controller.js');

/**
 * @param {{ canToggleConversation?: boolean, toggle?: StubEl | null }} [opts]
 */
function makeHeaderContext(opts = {}) {
  const header = new StubEl();
  const banner = new StubEl();
  const toggle =
    opts.toggle === undefined ? new StubEl() : (opts.toggle ?? null);
  const saveQueue = { id: 'queue' };
  return {
    header,
    banner,
    toggle,
    context: {
      viewModel: {
        caseRow: {
          id: 'case-1',
          title: 'Case One',
          assignedReviewer: 'Alex Reviewer',
        },
        machine: {
          canToggleConversation: opts.canToggleConversation ?? true,
        },
        saveQueue,
      },
      nodes: {
        tabs: null,
        details: null,
        questionsPanel: null,
        questionList: null,
        progress: null,
        overrideEditor: null,
        remediation: null,
        summary: null,
        notes: null,
        appeal: null,
        conversation: null,
        sourceCase: null,
        banner,
        conversationToggle: toggle,
        header,
        completeButton: null,
      },
      displayMode: (/** @type {any} */ mode) => mode,
      completeCase: async () => {},
      toggleConversationPanel: () => {},
    },
    saveQueue,
  };
}

test.todo(
  'CaseReviewNodeRegistry: creates the same long-lived page nodes currently cached by CRCaseReview'
);
// TODO(issue-198): Assert each expected custom element/button/header is created
// once and reused across renders so behavior remains stable while removing
// private element caching from the page class.

test.todo(
  'CaseReviewTabController: maps section access into visible tabs in the current order'
);
// TODO(issue-198): Cover details, Review, Issues, Summary, Notes, and Appeal tab
// descriptors; assert hidden sections are omitted and activeTab receives
// cr-tab-change ids.

test.todo(
  'QuestionPanelController: forwards answer and jump events to the view model and visible questions'
);
// TODO(issue-198): Verify cr-answer calls handleAnswer, section jumps scroll to
// the matching category or General fallback, and jump-unanswered scrolls to the
// first unanswered applicable question.

test.todo(
  'QuestionPanelController: assigns question list, progress, and override editor props'
);
// TODO(issue-198): Assert questions/answers/update calls, computeSectionProgress
// inputs, and override-only editor configuration without depending on private
// page fields.

test.todo(
  'RemediationPanelController: forwards capture and attribution events'
);
// TODO(issue-198): Verify cr-capture and cr-attribute event details are passed
// unchanged to handleCapture and handleAttribute.

test.todo(
  'RemediationPanelController: assigns Issues tab properties without changing capture behavior'
);
// TODO(issue-198): Cover responsibleParty shaping, captureGroups, canCapture,
// canAttribute, catalogue, answers, and attributeFailures update arguments.

test.todo(
  'SummaryNotesAppealController: assigns Summary, Notes, and Appeal tab props'
);
// TODO(issue-198): Assert computeOutcome/allAnswered are sent to Summary, Notes
// receives queue/case/access fields, and Appeal receives qaReviewer/correction
// context.

test.todo(
  'ConversationPanelController: preserves click and Alt+C conversation toggling'
);
// TODO(issue-198): Assert the toggle button and document keydown path call the
// same view-model toggle method and keep aria-expanded in sync.

test.todo(
  'ConversationPanelController: removes document-level listeners on disconnect'
);
// TODO(issue-198): Assert the controller unregisters keyboard handlers to avoid
// leaking shortcuts after CRCaseReview is disconnected.

test.todo(
  'CompletionController: preserves completion button visibility and transition patch behavior'
);
// TODO(issue-198): Assert the button hides unless all questions are answered and
// completion is allowed, disables during submit, uses transitionToCompleted when
// present, and re-enables after completion settles.

test.todo(
  'completeCase: flushes queued saves, patches with the stored ETag, and navigates on success'
);
// TODO(issue-198): Move existing _completeCase coverage to this public seam and
// include the no-client, no-queue, failed-flush, and failed-patch paths.

test.todo(
  'SourceCaseController: assigns QA Check source case props without changing override provenance'
);
// TODO(issue-198): Assert cr-source-case receives the resolved source case data,
// current user, client, saveQueue, override access, and sourceCaseId.

test('CaseReviewHeaderController: preserves title, reviewer, conversation toggle placement, and banner wiring', () => {
  const { context, header, banner, toggle, saveQueue } = makeHeaderContext();

  new CaseReviewHeaderController().update(/** @type {any} */ (context));

  assert.equal(/** @type {any} */ (banner).saveQueue, saveQueue);
  assert.equal(header._children.length, 3);
  assert.equal(header._children[0].textContent, 'Case One');
  assert.equal(header._children[1].textContent, 'Reviewer: Alex Reviewer');
  assert.equal(header._children[2], toggle);
});

test('CaseReviewHeaderController: omits the conversation toggle when the machine disallows it', () => {
  const { context, header, toggle } = makeHeaderContext({
    canToggleConversation: false,
  });

  new CaseReviewHeaderController().update(/** @type {any} */ (context));

  assert.equal(header._children.length, 2);
  assert.ok(!header._children.includes(/** @type {StubEl} */ (toggle)));
});

test('CaseReviewHeaderController: tolerates a missing conversation toggle node', () => {
  const { context, header } = makeHeaderContext({ toggle: null });

  new CaseReviewHeaderController().update(/** @type {any} */ (context));

  assert.equal(header._children.length, 2);
  assert.equal(header._children[0].textContent, 'Case One');
  assert.equal(header._children[1].textContent, 'Reviewer: Alex Reviewer');
});
