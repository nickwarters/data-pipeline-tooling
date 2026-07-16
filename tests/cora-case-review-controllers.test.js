// @ts-check
// Capability modules share one DOM harness, so they are registered through this
// entry point instead of being run as concurrent test files.
import './cora-case-review-controllers-shell.tests.js';
import './cora-case-review-controllers-questions.tests.js';
import './cora-case-review-controllers-issues.tests.js';
import './cora-case-review-controllers-remediation-tracking.tests.js';
import './cora-case-review-controllers-conversation.tests.js';
import './cora-case-review-controllers-outcomes.tests.js';
import './cora-case-review-controllers-completion.tests.js';
