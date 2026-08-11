// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePeopleClient } from './helpers/mock-sharepoint-client.js';

test('MockSharePointClient: resolveManagers follows the fixture edge and returns canonical bare accounts', async () => {
  const client = makePeopleClient();
  assert.deepEqual(await client.resolveManagers(['jsmith']), {
    jsmith: 'mmanager',
  });
});
