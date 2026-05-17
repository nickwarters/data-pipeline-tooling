// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  compileBank, highlight, escapeHtml, hashStr,
} from '../src/question-bank/question-bank-compile.js';

/** Tiny helper to build a bank with one question. */
function bank(/** @type {any} */ q) {
  return { label: 'L', slug: 's', eligibleGroups: ['G'], questions: [q] };
}

test('escapeHtml: escapes the five entities', () => {
  assert.equal(escapeHtml('<a href="x">&\'</a>'),
    '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});

test('escapeHtml: coerces non-string to string', () => {
  assert.equal(escapeHtml(/** @type {any} */ (123)), '123');
});

test('compileBank: emits header, eligibleGroups, computeOutcome, export', () => {
  const out = compileBank({
    label: 'L', slug: 's', eligibleGroups: ['Reviewers'],
    questions: [{ id: 'q1', text: 'T', responseType: 'yes-no-na', deprecated: false }],
  });
  assert.ok(out.startsWith('// @ts-check'));
  assert.ok(out.includes(`eligibleGroups: ["Reviewers"]`));
  assert.ok(out.includes('computeOutcome(answers)'));
  assert.ok(out.endsWith('export default config;'));
});

test('compileBank: omits category when absent', () => {
  const out = compileBank(bank({ id: 'q1', text: 'T', responseType: 'yes-no-na', deprecated: false }));
  assert.ok(!out.includes('category:'));
});

test('compileBank: includes category when present', () => {
  const out = compileBank(bank({ id: 'q1', text: 'T', category: 'Opening', responseType: 'yes-no-na', deprecated: false }));
  assert.ok(out.includes('category: "Opening"'));
});

test('compileBank: includes options when present', () => {
  const out = compileBank(bank({ id: 'q1', text: 'T', responseType: 'single-choice', options: ['A','B'], deprecated: false }));
  assert.ok(out.includes('options: ["A","B"]'));
});

test('compileBank: includes showWhen when present', () => {
  const out = compileBank(bank({ id: 'q1', text: 'T', responseType: 'yes-no-na', showWhen: { q0: { equals: 'Yes' } }, deprecated: false }));
  assert.ok(out.includes('showWhen:'));
});

test('compileBank: includes failureCriteria when present', () => {
  const out = compileBank(bank({ id: 'q1', text: 'T', responseType: 'yes-no-na', failureCriteria: 'No', deprecated: false }));
  assert.ok(out.includes('failureCriteria: "No"'));
});

test('compileBank: emits remediationActions array when present', () => {
  const out = compileBank(bank({
    id: 'q1', text: 'T', responseType: 'yes-no-na',
    remediationActions: ['Action 1', 'Action 2'], deprecated: false,
  }));
  assert.ok(out.includes('remediationActions: ['));
  assert.ok(out.includes('"Action 1"'));
  assert.ok(out.includes('"Action 2"'));
});

test('compileBank: emits allowFreeFormRemediation when truthy', () => {
  const out = compileBank(bank({
    id: 'q1', text: 'T', responseType: 'yes-no-na',
    allowFreeFormRemediation: true, deprecated: false,
  }));
  assert.ok(out.includes('allowFreeFormRemediation: true'));
});

test('compileBank: emits deprecated: true', () => {
  const out = compileBank(bank({ id: 'q1', text: 'T', responseType: 'yes-no-na', deprecated: true }));
  assert.ok(out.includes('deprecated: true'));
});

test('compileBank: empty questions still produces a valid module', () => {
  const out = compileBank({ label: 'L', slug: 's', eligibleGroups: [], questions: [] });
  assert.ok(out.includes('questions: ['));
  assert.ok(out.includes('export default config;'));
});

test('highlight: wraps comments, strings, keywords, booleans, and property keys', () => {
  const code = `const x = 'hi'; // comment\nreturn true;\nconst obj = { key: 1 };`;
  const out = highlight(code);
  assert.ok(out.includes('<span class="c">// comment</span>'));
  assert.ok(out.includes('<span class="k">const</span>'));
  assert.ok(out.includes('<span class="k">return</span>'));
  assert.ok(out.includes('<span class="b">true</span>'));
  assert.ok(out.includes('<span class="p">key</span>'));
  assert.ok(out.includes('<span class="s">&#39;hi&#39;</span>'));
});

test('highlight: handles double-quoted strings', () => {
  const out = highlight('const x = "hi";');
  assert.ok(out.includes('<span class="s">&quot;hi&quot;</span>'));
});

test('hashStr: returns 12 hex chars (6 bytes)', async () => {
  const h = await hashStr('hello world');
  assert.equal(h.length, 12);
  assert.match(h, /^[0-9a-f]{12}$/);
});

test('hashStr: deterministic for the same input', async () => {
  assert.equal(await hashStr('x'), await hashStr('x'));
});
