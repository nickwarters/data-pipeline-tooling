// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, StubEl } from './_dom-stub.js';

installDom();

const { mountCaseTypeUnavailableBanner } =
  await import('../src/setup/case-type-unavailable-banner.js');

test('mountCaseTypeUnavailableBanner: renders nothing when every Case Type loaded', () => {
  const appEl = new StubEl('div');
  const banner = mountCaseTypeUnavailableBanner([], /** @type {any} */ (appEl));

  assert.equal(banner, null);
  assert.equal(appEl.childElementCount, 0);
});

test('mountCaseTypeUnavailableBanner: names the Case Type that could not be loaded', () => {
  const appEl = new StubEl('div');
  const banner = /** @type {any} */ (
    mountCaseTypeUnavailableBanner(
      [
        {
          slug: 'example-review',
          displayName: 'Example Review',
          error: new Error('boom'),
        },
      ],
      /** @type {any} */ (appEl)
    )
  );

  assert.ok(banner, 'banner is returned');
  assert.equal(
    appEl.querySelector('.cora-banner'),
    banner,
    'banner is mounted into appEl'
  );
  assert.equal(
    banner.className,
    'cora-banner cora-banner-warning',
    'reuses the existing warning banner styling, not a new mechanism'
  );
  assert.equal(banner.getAttribute('role'), 'alert');
  assert.match(banner.textContent, /Case Type unavailable/);
  assert.match(banner.textContent, /Example Review/);
  assert.match(banner.textContent, /Reload to retry/);
  assert.doesNotMatch(
    banner.textContent,
    /boom/,
    'the raw error goes to the console, not to Reviewers'
  );
});

test('mountCaseTypeUnavailableBanner: reads naturally for more than one broken Case Type', () => {
  const appEl = new StubEl('div');
  const banner = /** @type {any} */ (
    mountCaseTypeUnavailableBanner(
      [
        { slug: 'a', displayName: 'Alpha Review', error: new Error('x') },
        { slug: 'b', displayName: 'Beta Review', error: new Error('y') },
      ],
      /** @type {any} */ (appEl)
    )
  );

  assert.match(banner.textContent, /Case Types unavailable/);
  assert.match(banner.textContent, /Alpha Review, Beta Review/);
});
