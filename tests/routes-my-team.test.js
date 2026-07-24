// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import { routeRegistrationSpy } from './helpers/router.js';

installDom();

const { register } = await import('../src/routes/my-team.js');

test('my team route registers and mounts #/my-team through the store route', async () => {
  let disposed = false;
  const registration = routeRegistrationSpy();
  register(
    /** @type {any} */ (registration.router),
    /** @type {any} */ ({ chrome: {}, caseSources: [] }),
    /** @type {any} */ (
      async () => ({
        createRouteSlice: () => ({
          initialState: {},
          reducer: (/** @type {any} */ state) => state,
          view: () => {
            const heading = document.createElement('h1');
            heading.textContent = 'My Team';
            return heading;
          },
          start: () => () => {
            disposed = true;
          },
        }),
      })
    )
  );

  assert.equal(registration.has('#/my-team'), true);
  const container = document.createElement('main');
  const handler = registration.handlerFor('#/my-team');
  await handler.mount(container, {});
  assert.equal(container.querySelector('h1')?.textContent, 'My Team');
  handler.unmount();
  assert.equal(disposed, true);
});
