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

test('anatomy explainer: teaches the state, view, action, reducer loop', () => {
  const html = read(DOC);
  assert.match(html, /State in/);
  assert.match(html, /DOM out/);
  assert.match(html, /Actions back/);
  assert.match(html, /greetingView/);
  assert.match(html, /greetingReducer/);
  assert.match(html, /greeting\/name-changed/);
});

test('anatomy explainer: documents the store-driven route boundary', () => {
  const html = read(DOC);
  const samples = codeSamples(html).join('\n');
  assert.match(html, /createRouteSlice/);
  assert.match(html, /createStoreRoute/);
  assert.match(samples, /import\('\.\.\/pages\/greeting\.js'\)/);
  assert.match(html, /route-local object/i);
});

test('anatomy explainer: assigns lifecycle and effects to the route edge', () => {
  const html = read(DOC);
  assert.match(html, /route\s+adapter owns lifecycle/i);
  assert.match(html, /listen\(\)/);
  assert.match(html, /start\(tools\)/);
  assert.match(html, /SharePointClient/);
  assert.match(html, /SaveQueue/);
});

test('anatomy explainer: documents view and dispatch boundaries', () => {
  const html = read(DOC);
  assert.match(html, /Views are synchronous/);
  assert.match(html, /dispatch actions/i);
  assert.match(html, /domain\/event/);
  assert.match(html, /cora-/);
});

test('anatomy explainer: documents the route checklist', () => {
  const html = read(DOC);
  assert.match(html, /Page import is lazy/);
  assert.match(html, /State is under/);
  assert.match(html, /View is pure and synchronous/);
  assert.match(html, /I\/O lives in an effect/);
});

test('anatomy explainer: worked examples honour the hard rules', () => {
  const samples = codeSamples(read(DOC));
  assert.ok(samples.length >= 2, 'expected at least two worked code samples');
  const allCode = samples.join('\n');
  // No innerHTML for user data; views never call fetch() directly.
  assert.doesNotMatch(allCode, /\.innerHTML\s*=/);
  assert.doesNotMatch(allCode, /\bfetch\(/);
});

test('anatomy explainer: does not revive deleted authoring concepts', () => {
  const html = read(DOC);
  assert.doesNotMatch(html, /ShellElement|defineView|connectedCallback/);
  assert.doesNotMatch(html, /app-layer signals?/i);
});

test('anatomy explainer: CLAUDE.md links to it', () => {
  const claudeMd = read('CLAUDE.md');
  assert.match(claudeMd, /docs\/component-anatomy-explainer\.html/);
});
