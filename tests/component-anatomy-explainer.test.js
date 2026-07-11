// @ts-check

import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = new URL('../', import.meta.url);

/** @param {string} path */
function read(path) {
  return readFileSync(new URL(path, ROOT), 'utf8');
}

const DOC = 'docs/component-anatomy-explainer.html';

/**
 * Extract the text of every `<pre …>…</pre>` code sample from the explainer so
 * assertions can target the worked examples specifically, not the surrounding
 * prose. HTML entities used in the samples are decoded back to source form.
 * @param {string} html
 * @returns {string[]}
 */
function codeSamples(html) {
  return [...html.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/g)].map((match) =>
    match[1]
      .replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
  );
}

test('anatomy explainer: exists and is a self-contained HTML document', () => {
  const html = read(DOC);
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /<title>[^<]*Anatomy[^<]*<\/title>/i);
  // Self-contained: no external resources (no CDN fonts, scripts, or images).
  assert.doesNotMatch(html, /https?:\/\//);
});

test('anatomy explainer: teaches both blessed shell wrappers', () => {
  const html = read(DOC);
  assert.match(html, /defineView/);
  assert.match(html, /ShellElement/);
  // Function-first core: pure h() functions that the shells delegate to.
  assert.match(html, /\bh\(/);
});

test('anatomy explainer: documents registration rules and the dev warning', () => {
  const html = read(DOC);
  assert.match(html, /customElements\.define/);
  assert.match(html, /side-effect import/i);
  // The MAINT-05 dev warning from src/lib/html.js.
  assert.match(html, /is not defined/);
});

test('anatomy explainer: documents lifecycle freebies and the advanced escape hatch', () => {
  const html = read(DOC);
  assert.match(html, /connectedCallback/);
  assert.match(html, /captureFocus/);
  assert.match(html, /restoreFocus/);
  // Points at the confirmed structural-signature example.
  assert.match(html, /cora-capture-groups/);
});

test('anatomy explainer: documents event conventions', () => {
  const html = read(DOC);
  assert.match(html, /emit\(/);
  assert.match(html, /bubbles:\s*true/);
  assert.match(html, /cora-/);
});

test('anatomy explainer: documents the new-component checklist', () => {
  const html = read(DOC);
  assert.match(html, /base/);
  assert.match(html, /sections/);
  assert.match(html, /collections/);
});

test('anatomy explainer: worked examples honour the hard rules', () => {
  const samples = codeSamples(read(DOC));
  assert.ok(samples.length >= 2, 'expected at least two worked code samples');
  const allCode = samples.join('\n');
  // No innerHTML for user data; components never call fetch() directly.
  assert.doesNotMatch(allCode, /\.innerHTML\s*=/);
  assert.doesNotMatch(allCode, /\bfetch\(/);
});

test('anatomy explainer: CLAUDE.md links to it', () => {
  const claudeMd = read('CLAUDE.md');
  assert.match(claudeMd, /docs\/component-anatomy-explainer\.html/);
});
