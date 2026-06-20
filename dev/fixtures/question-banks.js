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
 * @typedef {{
 *   id: string,
 *   text: string,
 *   category?: string,
 *   responseType: 'yes-no-na' | 'single-choice' | 'multi-choice',
 *   options?: string[],
 *   showWhen?: Record<string, unknown>,
 *   failureCriteria?: string,
 *   remediationActions?: string[],
 *   allowFreeFormRemediation?: boolean,
 *   deprecated: boolean,
 * }} DraftQuestion
 */

/**
 * @typedef {{
 *   label: string,
 *   slug: string,
 *   eligibleGroups: string[],
 *   questions: DraftQuestion[],
 * }} QuestionBank
 */

/** @type {Record<string, QuestionBank>} */
export const questionBanks = {
  'hello-review': {
    label: 'Hello Review',
    slug: 'hello-review',
    eligibleGroups: ['Reviewers'],
    questions: [
      {
        id: 'q-welcome',
        text: 'Was the customer greeted professionally?',
        category: 'Opening',
        responseType: 'yes-no-na',
        failureCriteria: 'No',
        deprecated: false,
      },
      {
        id: 'q-needs',
        text: "Were the customer's needs identified before proceeding?",
        category: 'Discovery',
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
    questions: [
      {
        id: 'q-acknowledged',
        text: 'Was the complaint acknowledged within SLA?',
        category: 'Intake',
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
