// @ts-check
import { HttpSharePointClient } from '../services/http-sharepoint-client.js';
import { loadNewDashboardConfig } from '../../case-types/new-dashboard/manifest.js';
import { mountNewDashboard } from './new-dashboard.js';
import { sharePointOptions } from './page-context.js';

/** @param {{root?: HTMLElement, hash?: string, client?: any}} [options] */
export async function startNewDashboard(options = {}) {
  const root = options.root ?? document.querySelector('[data-cora-root]');
  if (!(root instanceof HTMLElement))
    throw new Error('CORA root was not found.');
  const params = new URLSearchParams(location.search);
  const client =
    options.client ??
    (params.get('mock') === '1'
      ? await createMockClient(params.get('asUser') ?? 'reviewer')
      : new HttpSharePointClient(sharePointOptions()));
  return mountNewDashboard({
    root,
    hash: options.hash ?? location.hash,
    client,
    loadConfig: loadNewDashboardConfig,
  });
}

/** @param {string} persona */
export async function createMockClient(persona) {
  const [{ cases }, { personas }, { people }] = await Promise.all([
    import('../../dev/new-dashboard-cases.js'),
    import('../../dev/fixtures/personas.js'),
    import('../../dev/fixtures/people.js'),
  ]);
  const active = personas[persona] ?? personas.reviewer;
  let rows = structuredClone(cases);
  return {
    async getCase(/** @type {string} */ id) {
      return rows.find((row) => row.id === id) ?? null;
    },
    async patchCase(
      /** @type {string} */ id,
      /** @type {Record<string, any>} */ fields,
      /** @type {string} */ etag
    ) {
      const index = rows.findIndex((row) => row.id === id);
      if (index < 0) return { ok: false, status: 404 };
      if (rows[index].etag !== etag) return { ok: false, status: 412 };
      const next = { ...rows[index], ...fields, etag: `${etag}-next` };
      rows[index] = next;
      return { ok: true, status: 200, data: next };
    },
    async getCurrentUser() {
      return { id: active.userId, displayName: active.displayName };
    },
    async getCurrentUserGroups() {
      return active.groups;
    },
    async searchPeople(/** @type {string} */ query) {
      const needle = query.trim().toLowerCase();
      if (!needle) return [];
      return people.filter((person) =>
        `${person.displayName} ${person.loginName} ${person.email ?? ''}`
          .toLowerCase()
          .includes(needle)
      );
    },
  };
}
