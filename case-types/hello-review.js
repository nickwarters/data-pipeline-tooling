// @ts-check
/** @typedef {import('../src/sharepoint-client.js').CaseTypeConfig} CaseTypeConfig */
/** @typedef {import('../src/sharepoint-client.js').Answer} Answer */

/** @type {CaseTypeConfig} */
const config = {
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
    const hasNo = Object.values(answers).some(a => a.value === 'No');
    return { verdict: hasNo ? 'fail' : 'pass' };
  },
};

export default config;
