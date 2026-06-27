// @ts-check
/** @typedef {import('../src/sharepoint-client.js').CaseTypeConfig} CaseTypeConfig */
/** @typedef {import('../src/sharepoint-client.js').Answer} Answer */

/**
 * QA Check Case Type (issue #47, PRD #43) — the meta-review of a Completed
 * example-review Case. A **QA Reviewer** is the Assigned Reviewer here; they answer
 * these QA-specific Question Definitions about whether the original review was
 * conducted properly. This module is the `qa-{slug}` tracer for the extension
 * point: the framework treats it as an ordinary Case Type, so the standard
 * case-review shell, auto-save and Complete-Case flow all work unchanged.
 *
 * The link to the original Case lives on the Case row (`CaseRow.sourceCaseId`),
 * not in this config; the page fetches that original read-only and embeds the
 * Answer Override editor against it (ADR-0018). `computeOutcome` below sees the
 * QA Answers only — never the source Case's Answers.
 *
 * @type {CaseTypeConfig}
 */
const config = {
  eligibleGroups: ['QA-Reviewers'],
  slaHours: 48,
  // QA Answers are not attributed to a person — a QA Check assesses the review,
  // it does not raise Remediation Actions against the Responsible Party.
  attributeFailures: false,
  sections: {
    details: { showInSummary: true },
    questions: { showInSummary: true },
    notes: { showInSummary: false },
    summary: {},
  },
  questions: [
    {
      id: 'qa-process',
      text: 'Did the Reviewer follow the documented review process?',
      category: 'Process',
      responseType: 'yes-no-na',
      failureCriteria: 'No',
      remediationActions: [
        'Re-brief the Reviewer on the documented review process.',
      ],
      deprecated: false,
    },
    {
      id: 'qa-evidence',
      text: 'Was each failed Answer supported by adequate evidence?',
      category: 'Evidence',
      responseType: 'yes-no-na',
      failureCriteria: 'No',
      deprecated: false,
    },
    {
      id: 'qa-outcome-correct',
      text: 'Was the original Outcome correct?',
      category: 'Outcome',
      responseType: 'yes-no-na',
      failureCriteria: 'No',
      deprecated: false,
    },
    {
      id: 'qa-overturn-reason',
      text: 'Why was the original Outcome wrong?',
      category: 'Outcome',
      responseType: 'single-choice',
      options: [
        'Wrong answer recorded',
        'Missing evidence',
        'Misapplied policy',
      ],
      showWhen: { 'qa-outcome-correct': { equals: 'No' } },
      deprecated: false,
    },
  ],

  /**
   * QA outcome over the QA Answers only:
   *  - an incorrect original Outcome fails the QA Check;
   *  - a process or evidence lapse where the outcome still stood is referred;
   *  - otherwise the review passes QA.
   *
   * @param {Record<string, Answer>} answers
   */
  computeOutcome(answers) {
    if (answers['qa-outcome-correct']?.value === 'No')
      return { outcome: 'fail' };
    const lapsed =
      answers['qa-process']?.value === 'No' ||
      answers['qa-evidence']?.value === 'No';
    return { outcome: lapsed ? 'refer' : 'pass' };
  },
};

export default config;
