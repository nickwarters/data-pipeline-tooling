// @ts-check
/**
 * Seed data for the Question Bank curator workbench (#/question-bank).
 *
 * The shape mirrors what would be returned by a future SharePointClient
 * "list Case Types + their Question Definitions" call. Each case-type entry
 * carries `label`, `slug`, `eligibleGroups`, and an array of Question
 * Definitions whose shape matches QuestionDefinition in sharepoint-client.js.
 *
 * Kept here (not under case-types/) because the editor consumes a *snapshot*
 * across many case types; the compile step is what produces a case-types/
 * module.
 */

/**
 * A reporting label that can be assigned to Question Definitions from the
 * question bank. Purely a bank-side concept: labels are never recorded against
 * or edited from Cases. They carry a `color` so the editor can render a colour
 * pill, and they exist to support external reporting (ADR-0015) — they do not
 * affect how a question is presented to a Reviewer.
 *
 * @typedef {{ id: string, name: string, color: string }} Label
 */

/**
 * @typedef {import('../../src/sharepoint-client.js').OutcomeDescriptor} OutcomeDescriptor
 * @typedef {import('../../src/sharepoint-client.js').OutcomeOption} OutcomeOption
 * @typedef {import('../../src/sharepoint-client.js').RemediationActionDefinition} RemediationActionDefinition
 */

/**
 * @typedef {{
 *   id: string,
 *   text: string,
 *   category?: string,
 *   labelIds?: string[],
 *   responseType: 'yes-no-na' | 'single-choice' | 'multi-choice',
 *   options?: string[],
 *   showWhen?: Record<string, unknown>,
 *   showWhenMode?: 'always' | 'conditional',
 *   failureCriteria?: string,
 *   outcome?: { noActionOutcomeId?: string, noAction?: OutcomeDescriptor },
 *   remediationActions?: Array<string | RemediationActionDefinition>,
 *   allowFreeFormRemediation?: boolean,
 *   deprecated: boolean,
 * }} DraftQuestion
 */

/**
 * @typedef {{
 *   label: string,
 *   slug: string,
 *   eligibleGroups: string[],
 *   labels?: Label[],
 *   outcomeOptions?: OutcomeOption[],
 *   defaultOutcomeId?: string,
 *   questions: DraftQuestion[],
 * }} QuestionBank
 */

/** @type {Record<string, QuestionBank>} */
export const questionBanks = {
  'example-review': {
    label: 'Example Review',
    slug: 'example-review',
    eligibleGroups: ['Reviewers'],
    outcomeOptions: [
      { id: 'pass', wording: 'Pass', severity: 0 },
      { id: 'fail', wording: 'Fail', severity: 100 },
    ],
    defaultOutcomeId: 'pass',
    labels: [
      { id: 'lbl-coaching', name: 'Coaching', color: '#2563eb' },
      { id: 'lbl-regulatory', name: 'Regulatory', color: '#b91c1c' },
    ],
    questions: [
      {
        id: 'q-welcome',
        text: 'Was the customer greeted professionally?',
        category: 'Opening',
        labelIds: ['lbl-coaching'],
        responseType: 'yes-no-na',
        failureCriteria: 'No',
        deprecated: false,
      },
      {
        id: 'q-needs',
        text: "Were the customer's needs identified before proceeding?",
        category: 'Discovery',
        labelIds: ['lbl-coaching', 'lbl-regulatory'],
        responseType: 'yes-no-na',
        failureCriteria: 'No',
        remediationActions: ['Retrain agent on needs-identification protocol.'],
        deprecated: false,
      },
      {
        id: 'q-resolve',
        text: "Was the issue resolved to the customer's satisfaction?",
        category: 'Resolution',
        responseType: 'yes-no-na',
        showWhen: { 'q-needs': { equals: 'Yes' } },
        failureCriteria: 'No',
        remediationActions: ['Escalate unresolved case to senior agent.'],
        deprecated: false,
      },
      {
        id: 'q-channel',
        text: 'Which channel was the customer using?',
        category: 'Context',
        responseType: 'single-choice',
        options: ['Phone', 'Email', 'Chat'],
        deprecated: false,
      },
      {
        id: 'q-products',
        text: 'Which products were discussed during the interaction?',
        category: 'Context',
        responseType: 'multi-choice',
        options: ['Account', 'Billing', 'Support'],
        deprecated: false,
      },
    ],
  },
  'complaint-review': {
    label: 'Complaint Review',
    slug: 'complaint-review',
    eligibleGroups: ['Reviewers', 'ComplianceLeads'],
    outcomeOptions: [
      { id: 'pass', wording: 'Pass', severity: 0 },
      { id: 'refer', wording: 'Refer', severity: 50 },
      { id: 'fail', wording: 'Fail', severity: 100 },
    ],
    defaultOutcomeId: 'pass',
    labels: [
      { id: 'lbl-sla', name: 'SLA', color: '#d97706' },
      { id: 'lbl-regulatory', name: 'Regulatory', color: '#b91c1c' },
    ],
    questions: [
      {
        id: 'q-acknowledged',
        text: 'Was the complaint acknowledged within SLA?',
        category: 'Intake',
        labelIds: ['lbl-sla'],
        responseType: 'yes-no-na',
        failureCriteria: 'No',
        deprecated: false,
      },
      {
        id: 'q-severity',
        text: 'How was the complaint severity classified?',
        category: 'Intake',
        responseType: 'single-choice',
        options: ['Low', 'Medium', 'High', 'Regulatory'],
        deprecated: false,
      },
      {
        id: 'q-rootcause',
        text: 'Was a root cause documented?',
        category: 'Analysis',
        labelIds: ['lbl-regulatory'],
        responseType: 'yes-no-na',
        showWhen: {
          $and: [
            { 'q-acknowledged': { equals: 'Yes' } },
            {
              $or: [
                { 'q-severity': { equals: 'High' } },
                { 'q-severity': { equals: 'Regulatory' } },
              ],
            },
          ],
        },
        failureCriteria: 'No',
        remediationActions: ['Open RCA ticket.', 'Notify compliance lead.'],
        allowFreeFormRemediation: true,
        deprecated: false,
      },
      {
        id: 'q-legacy-flag',
        text: 'Was the legacy intake form used? (sunset 2024)',
        category: 'Intake',
        responseType: 'yes-no-na',
        deprecated: true,
      },
    ],
  },
};
