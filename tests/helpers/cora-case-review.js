// @ts-check
import '../_register-example-review.js';
import {
  installDom,
  StubEl,
  useElementClass,
  flush,
  waitForRender,
} from '../_dom-stub.js';
import { assertAllCoraElementsDefined } from './assert-defined-elements.js';
import {
  fireEvent,
  getByRole,
  getByTag,
  queryAllByTag,
} from './semantic-dom.js';

installDom();

// Stub for CORAQuestionList.update / CORARemediationSection.update / CORAOutcome.update.
// Records the most recent call so tests can observe what the page rendered.
class RecordingEl extends StubEl {
  constructor(tag = '') {
    super(tag);
    /** @type {any[] | undefined} */
    this._update = undefined;
  }
  update(/** @type {any[]} */ ...args) {
    this._update = args;
  }
}

useElementClass(RecordingEl);
import { CaseMachine, isReportable } from '../../src/lib/case-machine.js';
import { addWorkingDays } from '../../src/lib/add-working-days.js';
import {
  ENGLAND_WALES_HOLIDAYS,
  REMEDIATION_SLA_WORKING_DAYS,
} from '../../src/config/working-days.js';

/** @type {import('../../src/services/permissions.js').Capabilities} */
const NO_CAPABILITIES = {
  isReviewer: false,
  ownedCaseTypes: [],
  isAdviser: false,
  isReviewerManager: false,
  isResponsiblePartyManager: false,
  isMaintainer: false,
  listAccessCaseTypes: [],
  ownedJourneyCaseTypes: [],
  isControls: false,
  isVisitor: true,
};

/** @type {import('../../src/sharepoint-client.js').CaseTypeConfig} */
const EMPTY_CASE_TYPE_CONFIG = {
  questions: [],
  computeOutcome: () => ({ outcome: 'pass' }),
  outcomeOptions: [{ id: 'pass', wording: 'Pass', severity: 0 }],
  defaultOutcomeId: 'pass',
};

const { CaseReviewPage } = await import('../../src/pages/cora-case-review.js');
const { SaveQueue } = await import('../../src/services/save-queue.js');
const { completeCase } =
  await import('../../src/pages/cora-case-review/completion-actions.js');

/**
 * Thin test harness around the CaseReviewPage function component. The page is a
 * plain function returning a reactive() host; this adapter keeps the historic
 * "set fields, then connect" ergonomics while exposing the rendered host as a
 * public query root. Behaviour assertions read semantic output, not page
 * internals.
 */
class CaseReviewHarness {
  constructor() {
    /** @type {any} */
    this.client = null;
    /** @type {any} */
    this.saveQueue = null;
    this.caseId = '';
    /** @type {string | null} */
    this.caseType = null;
    this.currentUserId = '';
    /** @type {any} */
    this.capabilities = null;
    /** @type {any} */
    this._host = null;
  }

  async connectedCallback() {
    this._host = CaseReviewPage({
      client: this.client,
      saveQueue: this.saveQueue,
      caseId: this.caseId,
      caseType: this.caseType,
      currentUserId: this.currentUserId,
      capabilities: this.capabilities,
    });
    if (!this.client || !this.saveQueue || !this.caseId) return;
    await waitForRender(this._host);
  }

  get root() {
    return this._host;
  }

  /** @param {string} name */
  getAttribute(name) {
    return this._host ? this._host.getAttribute(name) : null;
  }

  disconnectedCallback() {
    this._host?.disconnectedCallback?.();
  }
}

/** @typedef {import('../../src/sharepoint-client.js').CaseRow} CaseRow */
/** @type {CaseRow} */
const BASE_ROW = {
  id: 'c1',
  caseType: 'example-review',
  title: 'Test Case',
  status: 'In-progress',
  assignedReviewer: 'u1',
  responsibleParty: 'u2',
  answers: {},
  conversation: [],
  notes: '',
  completedAt: null,
  etag: 'e1',
};

/**
 * @param {{ caseRow?: CaseRow, patchOk?: boolean, resolveUsers?: (accounts: string[]) => Promise<Record<string, string | null>>, exportHash?: string | null }} [opts]
 */
function makeClient({
  caseRow = BASE_ROW,
  patchOk = true,
  resolveUsers,
  exportHash = null,
} = {}) {
  return {
    async getCase() {
      return caseRow;
    },
    async getCurrentUser() {
      return { id: 'u1', displayName: 'User 1' };
    },
    async patchCase() {
      return { ok: patchOk, status: patchOk ? 200 : 500 };
    },
    async searchPeople() {
      return [];
    },
    resolveUsers: resolveUsers ?? (async () => ({})),
    async getExportHash() {
      return exportHash;
    },
  };
}

// Persistent chrome is queried by role/tag. Section panels are addressed by
// the public `cora-tabs` panel id contract from ADR-0014.
const rootOf = (/** @type {CaseReviewHarness} */ el) => el.root;
const bannerOf = (/** @type {CaseReviewHarness} */ el) =>
  getByTag(rootOf(el), 'cora-status-banner');
const headerOf = (/** @type {CaseReviewHarness} */ el) =>
  getByRole(rootOf(el), 'banner');
const tabsOf = (/** @type {CaseReviewHarness} */ el) =>
  getByTag(rootOf(el), 'cora-tabs');
const conversationOf = (/** @type {CaseReviewHarness} */ el) =>
  getByTag(rootOf(el), 'cora-conversation');
const completeBtnOf = (/** @type {CaseReviewHarness} */ el) =>
  getByRole(rootOf(el), 'button', { name: /^(Complete Case|Send Actions)$/ });
const panelOf = (/** @type {any} */ el, /** @type {string} */ id) =>
  tabsOf(el).panels[id];
const tabFor = (/** @type {any} */ el, /** @type {string} */ id) =>
  tabsOf(el).tabs.find((/** @type {any} */ t) => t.id === id);
const questionSectionOf = (/** @type {any} */ el) => panelOf(el, 'questions');
// The Issues capture tab keeps the `cora-remediation-section` node under the
// `issues` panel key after the ADR-0024 split; `remediation` is the new tracking
// tab (`cora-remediation-tracking`).
const remediationOf = (/** @type {any} */ el) => panelOf(el, 'issues');
const trackingOf = (/** @type {any} */ el) => panelOf(el, 'remediation');
const summaryOf = (/** @type {any} */ el) => panelOf(el, 'summary');
const notesOf = (/** @type {any} */ el) => panelOf(el, 'notes');
const detailsOf = (/** @type {any} */ el) => panelOf(el, 'details');

/**
 * A client whose patchCase records the fields it was asked to write, so a test
 * can assert exactly what landed in the single completion PATCH.
 * @param {{ patchOk?: boolean }} [opts]
 */
function makeRecordingClient({ patchOk = true } = {}) {
  /** @type {Array<{ id: string, fields: any, etag: string }>} */
  const patches = [];
  return {
    patches,
    async getCase() {
      return BASE_ROW;
    },
    async getCurrentUser() {
      return { id: 'u1', displayName: 'User 1' };
    },
    async patchCase(
      /** @type {string} */ id,
      /** @type {any} */ fields,
      /** @type {string} */ etag
    ) {
      patches.push({ id, fields, etag });
      return { ok: patchOk, status: patchOk ? 200 : 500 };
    },
    async searchPeople() {
      return [];
    },
    async resolveUsers() {
      return {};
    },
    async getExportHash() {
      return null;
    },
  };
}

// The Alt+C shortcut is registered by the page shell through on(document,
// 'keydown', …); the binding's Alt+C/other-key handling in isolation is covered
// in tests/cora-case-review-controllers.test.js (createConversationPanelBinding).

// The page shell tears its reactive view (and the on() document listener) down
// cleanly when it disconnects.

/** @type {import('../../src/sharepoint-client.js').CaseTypeConfig} */
const ATTRIBUTE_CONFIG = {
  questions: [],
  computeOutcome: () => ({ outcome: 'pass' }),
  outcomeOptions: [{ id: 'pass', wording: 'Pass', severity: 0 }],
  defaultOutcomeId: 'pass',
  attributeFailures: true,
};

/**
 * @param {'In-progress'|'Actions In Progress'|'Completed'} status
 * @param {import('../../src/sharepoint-client.js').CaseTypeConfig} [config]
 */
const machineForStatus = (status, config = EMPTY_CASE_TYPE_CONFIG) =>
  new CaseMachine(
    { ...BASE_ROW, status },
    { id: 'u1' },
    NO_CAPABILITIES,
    config
  );

/** @type {import('../../src/sharepoint-client.js').CaseTypeConfig} */
const ACTIONS_CONFIG = {
  questions: [],
  computeOutcome: () => ({ outcome: 'pass' }),
  outcomeOptions: [{ id: 'pass', wording: 'Pass', severity: 0 }],
  defaultOutcomeId: 'pass',
  captureGroups: [
    {
      key: 'g',
      label: 'G',
      fields: [{ key: 'acts', label: 'Acts', type: 'actions' }],
    },
  ],
};

export {
  ACTIONS_CONFIG,
  ATTRIBUTE_CONFIG,
  BASE_ROW,
  CaseMachine,
  CaseReviewHarness,
  CaseReviewPage,
  EMPTY_CASE_TYPE_CONFIG,
  ENGLAND_WALES_HOLIDAYS,
  NO_CAPABILITIES,
  REMEDIATION_SLA_WORKING_DAYS,
  RecordingEl,
  SaveQueue,
  StubEl,
  addWorkingDays,
  assertAllCoraElementsDefined,
  bannerOf,
  completeBtnOf,
  completeCase,
  conversationOf,
  detailsOf,
  fireEvent,
  flush,
  getByRole,
  getByTag,
  headerOf,
  installDom,
  isReportable,
  machineForStatus,
  makeClient,
  makeRecordingClient,
  notesOf,
  panelOf,
  queryAllByTag,
  questionSectionOf,
  remediationOf,
  rootOf,
  summaryOf,
  tabFor,
  tabsOf,
  trackingOf,
  useElementClass,
};
