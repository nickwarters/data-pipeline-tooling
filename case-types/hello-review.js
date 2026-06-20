// @ts-check
/** @typedef {import('../src/sharepoint-client.js').CaseTypeConfig} CaseTypeConfig */
/** @typedef {import('../src/sharepoint-client.js').Answer} Answer */

/** @type {CaseTypeConfig} */
const config = {
  eligibleGroups: ['Reviewers'],
  slaHours: 48,
  attributeFailures: true,
  // Per-Section config object (ADR-0016): membership is the allow-list, and
  // showInSummary controls each Section's block in the read-only Summary. Notes
  // is deliberately excluded from Summary (Case Justification + general note).
  sections: {
    details: { showInSummary: true },
    questions: { showInSummary: true },
    conversation: {},
    notes: { showInSummary: false },
    remediation: { showInSummary: true },
    summary: {},
    appeal: {},
  },
  // Configurable per-failure capture fields (ADR-0017). One shared set applies
  // to every failed Answer; captured inline as Answer.remediationDetails. Legacy:
  // superseded by captureGroups below (ADR-0020) but kept while both coexist.
  remediationFields: [
    { key: 'rootCause', label: 'Root cause', type: 'text', required: true },
    {
      key: 'severity',
      label: 'Severity',
      type: 'select',
      options: ['Low', 'Med', 'High'],
    },
  ],
  // Unified Issue Capture engine (ADR-0020): everything captured against a failed
  // Answer, as ordered, collapsible groups of typed fields. This slice exercises
  // the four string field types; person/actions arrive in their own slices.
  captureGroups: [
    {
      key: 'cause',
      label: 'Cause',
      collapsed: false,
      fields: [
        { key: 'rootCause', label: 'Root cause', type: 'text', required: true },
        { key: 'whatHappened', label: 'What happened', type: 'textarea' },
      ],
    },
    {
      key: 'grading',
      label: 'Grading',
      collapsed: true,
      fields: [
        {
          key: 'severity',
          label: 'Severity',
          type: 'select',
          options: ['Low', 'Med', 'High'],
        },
        {
          key: 'repeatIssue',
          label: 'Repeat issue?',
          type: 'radio',
          options: ['Yes', 'No'],
        },
      ],
    },
  ],
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
      responseType: 'single-choice',
      options: ['Phone', 'Email', 'Chat'],
      deprecated: false,
    },
    {
      id: 'q-products',
      text: 'Which products were discussed during the interaction?',
      responseType: 'multi-choice',
      options: ['Account', 'Billing', 'Support'],
      deprecated: false,
    },
  ],

  /** @param {Record<string, Answer>} answers */
  computeOutcome(answers) {
    const hasNo = Object.values(answers).some((a) => a.value === 'No');
    return { verdict: hasNo ? 'fail' : 'pass' };
  },
};

export default config;
