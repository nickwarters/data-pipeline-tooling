// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';

installDom();

const { headlineStripView } =
  await import('../src/pages/my-stats/headline-strip-view.js');

/** @param {Partial<any>} [overrides] */
function headline(overrides = {}) {
  return /** @type {any} */ ({
    total: 47,
    workingDays: 11,
    averagePerWorkingDay: 47 / 11,
    activeDays: 9,
    busiestDay: { date: '2026-08-04', count: 12 },
    ...overrides,
  });
}

/** @param {HTMLElement} strip @returns {string[][]} */
function figures(strip) {
  return Array.from(strip.querySelectorAll('.cora-my-stats-figure')).map(
    (figure) => [
      figure.querySelector('.cora-my-stats-figure__label')?.textContent ?? '',
      figure.querySelector('.cora-my-stats-figure__value')?.textContent ?? '',
      figure.querySelector('.cora-my-stats-figure__detail')?.textContent ?? '',
    ]
  );
}

test('headline strip: the four figures, in the order the ticket names them', () => {
  const strip = headlineStripView(headline());

  assert.deepEqual(figures(strip), [
    ['Total *', '47', ''],
    ['Avg per working day', '4.3', '11 working days'],
    ['Active days', '9', ''],
    ['Busiest day', '4 Aug', '12 Cases'],
  ]);
});

test('headline strip: the asterisk carries the today rule', () => {
  const strip = headlineStripView(headline());

  assert.equal(
    strip.querySelector('.cora-my-stats-headline__note')?.textContent,
    '* excludes today'
  );
});

test('headline strip: the average is never shortened to a per-day figure', () => {
  const text = headlineStripView(headline()).textContent;

  assert.match(text, /Avg per working day/);
  assert.doesNotMatch(text, /avg\/day/i);
});

test('headline strip: no working days and no work leaves an em dash rather than a number', () => {
  const strip = headlineStripView(
    headline({
      total: 0,
      workingDays: 0,
      averagePerWorkingDay: null,
      activeDays: 0,
      busiestDay: null,
    })
  );

  assert.deepEqual(figures(strip), [
    ['Total *', '0', ''],
    ['Avg per working day', '—', '0 working days'],
    ['Active days', '0', ''],
    ['Busiest day', '—', ''],
  ]);
});

test('headline strip: single working day and single Case read as singulars', () => {
  const strip = headlineStripView(
    headline({
      total: 1,
      workingDays: 1,
      averagePerWorkingDay: 1,
      activeDays: 1,
      busiestDay: { date: '2026-12-01', count: 1 },
    })
  );

  assert.deepEqual(figures(strip), [
    ['Total *', '1', ''],
    ['Avg per working day', '1.0', '1 working day'],
    ['Active days', '1', ''],
    ['Busiest day', '1 Dec', '1 Case'],
  ]);
});

test('headline strip: the section names itself for assistive technology', () => {
  const strip = headlineStripView(headline());
  const heading = strip.querySelector('.cora-my-stats-headline__heading');

  assert.equal(strip.tagName, 'SECTION');
  assert.equal(
    strip.getAttribute('aria-labelledby'),
    heading?.getAttribute('id')
  );
  assert.equal(heading?.textContent, 'Headline figures');
});
