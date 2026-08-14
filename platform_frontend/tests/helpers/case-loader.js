// @ts-check
import { CaseLoader } from '../../src/lib/case-loader.js';
import { makeCaseRow, makePermissions } from './fixtures.js';

/** @param {any} [overrides] */
export function makeLoader({
  row = {},
  client = {},
  saveQueue = {},
  ...rest
} = {}) {
  const loadedRow = makeCaseRow({
    id: 'c1',
    caseType: 'example-review',
    title: 'T',
    assignedReviewer: 'u1',
    responsibleParty: 'u2',
    etag: 'e1',
    ...row,
  });
  return new CaseLoader({
    client: /** @type {any} */ ({
      getCase: async () => loadedRow,
      getCurrentUser: async () => ({ id: 'u1', displayName: 'User 1' }),
      getExportHash: async () => null,
      getVersionedExport: async () => null,
      resolveUsers: async () => ({}),
      ...client,
    }),
    saveQueue: /** @type {any} */ ({
      loadCase() {},
      enqueue() {},
      ...saveQueue,
    }),
    caseId: 'c1',
    currentUserId: 'u1',
    capabilities: makePermissions({ isReviewer: false }),
    ...rest,
  });
}
