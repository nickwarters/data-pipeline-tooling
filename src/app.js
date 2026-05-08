// @ts-check

/** @returns {Promise<void>} */
async function boot() {
  const params = new URLSearchParams(location.search);
  const mockMode = params.get('mock') === '1';
  const persona = params.get('asUser') ?? 'reviewer';

  /** @type {import('./sharepoint-client.js').SharePointClient} */
  let client;

  if (mockMode) {
    const [{ MockSharePointClient }, { cases }, { questionDefinitions }, { personas }] = await Promise.all([
      import('./mock-sharepoint-client.js'),
      import('../dev/fixtures/cases.js'),
      import('../dev/fixtures/question-definitions.js'),
      import('../dev/fixtures/personas.js'),
    ]);
    client = new MockSharePointClient({ cases, questionDefinitions, personas, persona });
  } else {
    const { HttpSharePointClient } = await import('./http-sharepoint-client.js');
    client = new HttpSharePointClient();
  }

  const { Router } = await import('./router.js');
  const { SaveQueue } = await import('./save-queue.js');
  const { resolveCapabilities } = await import('./permissions.js');
  await import('./cr-allocation.js');
  await import('./cr-owner-summary.js');
  await import('./cr-dashboard.js');
  await import('./cr-case-review.js');

  const saveQueue = new SaveQueue(client);
  const router = new Router();
  const [currentUser, userGroups] = await Promise.all([
    client.getCurrentUser(),
    client.getCurrentUserGroups(),
  ]);
  const capabilities = resolveCapabilities(userGroups);

  // Compute which case types the current user is eligible to review.
  // Each case type module declares eligibleGroups; we check for group intersection.
  const { default: helloReviewConfig } = await import('../case-types/hello-review.js');
  /** @type {string[]} */
  const eligibleCaseTypes = [];
  if (helloReviewConfig.eligibleGroups?.some(g => userGroups.includes(g))) {
    eligibleCaseTypes.push('hello-review');
  }

  const appEl = /** @type {Element} */ (document.getElementById('app'));

  router.register('#/', {
    mount() { location.hash = '#/dashboard'; },
    unmount() {},
  });

  router.register('#/dashboard', {
    mount(container) {
      const el = /** @type {import('./cr-dashboard.js').CRDashboard} */ (
        document.createElement('cr-dashboard')
      );
      el.client = client;
      el.currentUserId = currentUser.id;
      el.capabilities = capabilities;
      el.eligibleCaseTypes = eligibleCaseTypes;
      container.replaceChildren(el);
    },
    unmount() {},
  });

  router.register('#/case/:id', {
    mount(container, params) {
      const el = /** @type {import('./cr-case-review.js').CRCaseReview} */ (
        document.createElement('cr-case-review')
      );
      el.client = client;
      el.saveQueue = saveQueue;
      el.caseId = params.id;
      container.replaceChildren(el);
    },
    unmount() {},
  });

  router.init(appEl);
}

boot().catch(err => console.error('[RALPH] Boot error:', err));
