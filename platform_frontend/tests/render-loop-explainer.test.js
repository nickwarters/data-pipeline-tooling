// @ts-check

import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = new URL('../', import.meta.url);

/** @param {string} path */
function read(path) {
  return readFileSync(new URL(path, ROOT), 'utf8');
}

const DOC = 'docs/render-loop-explainer.html';

test('render loop explainer: exists and is a self-contained HTML document', () => {
  const html = read(DOC);
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /<title>[^<]*Render Loop[^<]*<\/title>/i);
});

test('render loop explainer: no external script sources', () => {
  const html = read(DOC);
  assert.doesNotMatch(html, /<script[^>]+src=/i);
});

test('render loop explainer: the only external references are the Google Fonts stylesheet', () => {
  const html = read(DOC);
  // Strip inline <script> bodies first: the transcribed html.js carries the
  // SVG XML namespace URI as a string constant, which is not a network
  // reference and is not what this check is about.
  const markup = html.replace(/<script[^>]*>[\s\S]*?<\/script>/g, '');
  const urls = [...markup.matchAll(/https?:\/\/[^\s"'<>)]+/g)].map((m) => m[0]);
  assert.ok(urls.length > 0, 'expected at least the Google Fonts links');
  for (const url of urls) {
    assert.ok(
      /^https:\/\/fonts\.(googleapis|gstatic)\.com(\/|$)/.test(url),
      `unexpected external reference: ${url}`
    );
  }
});

test('render loop explainer: attributes every transcribed render.js identifier to its source', () => {
  const html = read(DOC);
  const renderSrc = read('src/core/render.js');
  const identifiers = [
    'patchChildren',
    'patchProps',
    'patchFormProp',
    'placeChildren',
    'longestIncreasingSubsequence',
    'sameType',
    'keyOf',
    'normalizeRoot',
  ];
  for (const id of identifiers) {
    // Every one of these is a plain `function` declaration in both the
    // transcript and the source — assert the definition, not just the name,
    // so a deleted/inlined function can't survive as a stray comment mention.
    const pattern = new RegExp(`function ${id}\\b`);
    assert.match(html, pattern, `explainer must define ${id}`);
    assert.match(
      renderSrc,
      pattern,
      `${id} must be defined in src/core/render.js`
    );
  }
});

test('render loop explainer: attributes every transcribed html.js identifier to its source', () => {
  const html = read(DOC);
  const htmlSrc = read('src/lib/html.js');
  const identifiers = [
    'NODE_PROPS',
    'applyProp',
    'removeProp',
    'getProps',
    'setProps',
  ];
  for (const id of identifiers) {
    // NODE_PROPS is a module-level var/const, not a function declaration;
    // everything else here is a plain `function` declaration.
    const pattern =
      id === 'NODE_PROPS'
        ? new RegExp(`(?:var|const) ${id}\\b`)
        : new RegExp(`function ${id}\\b`);
    assert.match(html, pattern, `explainer must define ${id}`);
    assert.match(htmlSrc, pattern, `${id} must be defined in src/lib/html.js`);
  }
});

test('render loop explainer: attributes every transcribed store.js identifier to its source', () => {
  const html = read(DOC);
  const storeSrc = read('src/core/store.js');
  const identifiers = ['notifyScheduled', 'onStateChange', 'queueMicrotask'];
  for (const id of identifiers) {
    assert.match(html, new RegExp(id), `explainer must name ${id}`);
    assert.match(
      storeSrc,
      new RegExp(id),
      `${id} must exist in src/core/store.js`
    );
  }
});

test('render loop explainer: attributes createMemo to memo.js', () => {
  const html = read(DOC);
  const memoSrc = read('src/core/memo.js');
  assert.match(html, /createMemo/);
  assert.match(memoSrc, /createMemo/);
});

test('render loop explainer: attributes every transcribed store-route.js identifier to its source', () => {
  const html = read(DOC);
  const storeRouteSrc = read('src/core/store-route.js');
  const identifiers = ['createStoreRoute', 'mountSequence', 'isActive'];
  for (const id of identifiers) {
    assert.match(html, new RegExp(id), `explainer must name ${id}`);
    assert.match(
      storeRouteSrc,
      new RegExp(id),
      `${id} must exist in src/core/store-route.js`
    );
  }
});

test('render loop explainer: does not revive dead vocabulary', () => {
  const html = read(DOC);
  assert.doesNotMatch(html, /ShellElement|defineView|connectedCallback/);
  assert.doesNotMatch(html, /\bsignal\(\)|\bcomputed\(\)|\beffect\(\)/);
});

test('render loop explainer: is linked from the guide index and platform_frontend CLAUDE.md', () => {
  const guideReadme = read('docs/guide/README.md');
  const claudeMd = read('CLAUDE.md');
  assert.match(guideReadme, /render-loop-explainer\.html/);
  assert.match(claudeMd, /docs\/render-loop-explainer\.html/);
  // The literal string component-anatomy-explainer.html must remain on the
  // CLAUDE.md line, or tests/component-anatomy-explainer.test.js fails.
  assert.match(claudeMd, /docs\/component-anatomy-explainer\.html/);
});
