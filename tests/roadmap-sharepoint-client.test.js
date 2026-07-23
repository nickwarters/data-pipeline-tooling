// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpSharePointClient } from '../src/services/http-sharepoint-client.js';
import { MockSharePointClient } from '../src/services/mock-sharepoint-client.js';

const item = {
  id: '1',
  title: 'Delivery',
  description: 'A roadmap item',
  theme: 'Core',
  labels: ['2027', 'P1'],
  status: /** @type {const} */ ('UPCOMING'),
};

test('MockSharePointClient: returns defensive copies of roadmap fixtures', async () => {
  const client = new MockSharePointClient({
    personas: {},
    roadmapItems: [item],
  });

  const first = await client.listRoadmapItems();
  first[0].labels.push('mutated');
  const second = await client.listRoadmapItems();

  assert.deepEqual(second, [item]);
});

test('HttpSharePointClient: maps roadmap rows and prefixes the Roadmap list in UAT', async () => {
  /** @type {string[]} */
  const calls = [];
  const client = new HttpSharePointClient({
    webUrl: 'https://sp.example.test/site',
    listPrefix: 'uat_',
    fetchImpl: async (input) => {
      calls.push(String(input));
      return new Response(
        JSON.stringify({
          value: [
            {
              Id: 7,
              Title: 'Delivery',
              Description: 'A roadmap item',
              Theme: 'Core',
              Labels: { results: ['2027', 'P1'] },
              Status: 'Upcoming',
            },
          ],
        }),
        { status: 200 }
      );
    },
  });

  const rows = await client.listRoadmapItems();

  assert.match(calls[0], /getbytitle\('uat_Roadmap'\)/);
  assert.match(calls[0], /[?&]\$select=/);
  assert.deepEqual(rows, [{ ...item, id: '7' }]);
});
