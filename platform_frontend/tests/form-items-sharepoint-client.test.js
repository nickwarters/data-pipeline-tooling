// @ts-check
/**
 * The Form list reads and writes, held to one behaviour across both clients.
 *
 * The Http side runs against a small in-memory SharePoint list that stores
 * what the wire carries — Person columns as numeric ids, dates as instants,
 * free text as sent — and answers reads with expanded people and an ETag. The
 * same behaviour tests then run against the mock, so the dev loop and a deploy
 * cannot disagree about what a Form write does.
 *
 * Query semantics (who is involved, open or closed, a date window, ordering
 * and paging) are held behaviourally on the mock and as exact query text on
 * the Http client, because the server evaluates the Http query.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpSharePointClient } from '../src/services/http-sharepoint-client.js';
import {
  MockSharePointClient,
  storedFormFields,
} from '../src/services/mock-sharepoint-client.js';
import { withAbortSignal } from '../src/services/abortable-client.js';
import { encodeText } from '../src/services/form-encoding.js';
import { formColumnKinds } from '../src/services/form-items.js';
import { startOfLocalDay } from '../src/lib/local-calendar.js';
import { oneToOne } from '../form-types/one-to-one.js';
import { formLists } from '../dev/fixtures/forms.js';
import { APP_CONFIG } from '../src/app-config.js';
import { WEB_URL, makeFetch } from './helpers/http-sharepoint-client.js';

/** @typedef {import('../src/sharepoint-client.js').FormValue} FormValue */
/** @typedef {import('../src/sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../src/services/mock-sharepoint-client.js').StoredFormItem} StoredFormItem */

const SAM = { loginName: 'sam', displayName: 'Sam Patel' };
const ANA = { loginName: 'ana', displayName: 'Ana Lopez' };
const JO = { loginName: 'jo', displayName: 'Jo Reid' };
const DIRECTORY = [SAM, ANA, JO];

/** @returns {Record<string, FormValue>} */
function newForm() {
  return {
    Employee: SAM,
    CurrentFirstLineManager: ANA,
    CurrentSecondLineManager: JO,
    FirstLineManager: ANA,
    Status: 'Pending',
    DueDate: '2026-10-31',
    MeetingDate: '2026-10-28',
    CompetencyStage: 'Stage 2',
    Agenda: 'Quarter review — what’s next? £ 🙂',
    Wellbeing: 'Line one\nLine two',
    Actions: [
      {
        title: 'Book the course',
        dueDate: '2026-11-15',
        status: 'Pending',
        details: 'October intake.',
      },
    ],
  };
}

/**
 * An in-memory SharePoint list behind `fetch`, holding items as the wire
 * writes them. People resolve through EnsureUser to ids in `DIRECTORY` order.
 *
 * @param {{ listPrefix?: string, seed?: StoredFormItem[] }} [options]
 */
function formBackend({ listPrefix = '', seed = [] } = {}) {
  const kinds = formColumnKinds(oneToOne);
  const list = `${listPrefix}${oneToOne.listName}`;
  /** @type {Map<number, { etag: number, created: string, body: Record<string, unknown> }>} */
  const items = new Map();
  let nextId = 1;
  let clock = 0;
  const stamp = () => new Date(Date.UTC(2026, 9, 1, 9, clock++)).toISOString();

  /** @param {unknown} person */
  const idOf = (person) =>
    DIRECTORY.findIndex(
      (p) => p.loginName === /** @type {any} */ (person)?.loginName
    ) + 1 || null;

  for (const row of seed) {
    /** @type {Record<string, unknown>} */
    const body = {};
    for (const [column, value] of Object.entries(row.fields)) {
      const kind = kinds.get(column);
      if (kind === 'person') body[`${column}Id`] = idOf(value);
      else if (kind === 'date') {
        body[column] = value
          ? startOfLocalDay(String(value)).toISOString()
          : null;
      } else body[column] = value;
    }
    items.set(Number(row.id), { etag: 1, created: row.created, body });
    nextId = Math.max(nextId, Number(row.id) + 1);
  }

  /** @param {number} id */
  const wire = (id) => {
    const item = /** @type {NonNullable<ReturnType<typeof items.get>>} */ (
      items.get(id)
    );
    /** @type {Record<string, unknown>} */
    const out = {
      Id: id,
      Created: item.created,
      Modified: item.created,
      'odata.etag': `"${item.etag}"`,
    };
    for (const [column, kind] of kinds) {
      if (kind === 'person') {
        const n = /** @type {number | null} */ (item.body[`${column}Id`]);
        const person = n ? DIRECTORY[n - 1] : null;
        out[column] = person
          ? {
              Name: `i:0#.w|corp\\${person.loginName}`,
              Title: person.displayName,
            }
          : null;
      } else {
        out[column] = item.body[column] ?? null;
      }
    }
    return out;
  };

  /** @param {unknown} body @param {number} [status] */
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status });

  const itemPath = new RegExp(
    `getbytitle\\('${list}'\\)/items\\('?(\\d+)'?\\)`
  );
  const { fetch, calls } = makeFetch([
    {
      when: (c) => c.url.endsWith('/_api/contextinfo'),
      respond: () => json({ FormDigestValue: 'd' }),
    },
    {
      when: (c) => c.url.includes('clientPeoplePickerSearchUser'),
      respond: () => json({ value: '[]' }),
    },
    {
      when: (c) => c.url.endsWith('/_api/web/ensureuser'),
      respond: () => {
        const logon = String(JSON.parse(String(calls.at(-1)?.body)).logonName);
        const account = logon.slice(logon.lastIndexOf('\\') + 1);
        const id = DIRECTORY.findIndex((p) => p.loginName === account) + 1;
        return id ? json({ Id: id }) : new Response('', { status: 500 });
      },
    },
    {
      when: (c) => c.method === 'POST' && c.url.includes(`('${list}')/items`),
      respond: () => {
        const id = nextId++;
        items.set(id, {
          etag: 1,
          created: stamp(),
          body: JSON.parse(String(calls.at(-1)?.body)),
        });
        return json({ Id: id }, 201);
      },
    },
    {
      when: (c) => c.method === 'PATCH',
      respond: () => {
        const call = /** @type {NonNullable<ReturnType<typeof calls.at>>} */ (
          calls.at(-1)
        );
        const id = Number(itemPath.exec(call.url)?.[1]);
        const item = items.get(id);
        if (!item) return new Response('', { status: 404 });
        if (call.headers['if-match'] !== `"${item.etag}"`) {
          return new Response('', { status: 412 });
        }
        Object.assign(item.body, JSON.parse(String(call.body)));
        item.etag += 1;
        return new Response(null, { status: 204 });
      },
    },
    {
      when: (c) => c.method === 'GET' && itemPath.test(c.url),
      respond: () => {
        const id = Number(itemPath.exec(String(calls.at(-1)?.url))?.[1]);
        return items.has(id)
          ? json(wire(id))
          : new Response('', { status: 404 });
      },
    },
    {
      when: (c) => c.method === 'GET' && c.url.includes(`('${list}')/items?`),
      respond: () => json({ value: [...items.keys()].map(wire) }),
    },
  ]);
  return { fetch, calls, items };
}

/**
 * What each client's list itself holds in one column, below its decoding:
 * what someone opening the list in SharePoint sees.
 *
 * @type {WeakMap<object, (id: string, column: string) => unknown>}
 */
const listHolds = new WeakMap();

/**
 * @param {{ seed?: StoredFormItem[] }} [options]
 * @returns {SharePointClient}
 */
function httpClient({ seed } = {}) {
  const { fetch, items } = formBackend({ seed });
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });
  listHolds.set(client, (id, column) => items.get(Number(id))?.body[column]);
  return client;
}

/**
 * @param {{ seed?: StoredFormItem[] }} [options]
 * @returns {SharePointClient}
 */
function mockClient({ seed = [] } = {}) {
  const client = new MockSharePointClient({
    personas: {},
    formLists: { [oneToOne.listName]: seed },
  });
  listHolds.set(
    client,
    (id, column) =>
      /** @type {any} */ (client)._formLists[oneToOne.listName].find(
        (/** @type {StoredFormItem} */ row) => row.id === id
      )?.fields[column]
  );
  return client;
}

/**
 * @param {string} id
 * @param {Record<string, FormValue>} fields
 * @returns {StoredFormItem}
 */
function stored(id, fields) {
  return {
    id,
    etag: '"1"',
    created: '2026-09-01T09:00:00Z',
    modified: '2026-09-01T09:00:00Z',
    fields: storedFormFields(oneToOne, fields),
  };
}

for (const [name, makeClient] of /** @type {const} */ ([
  ['HttpSharePointClient', httpClient],
  ['MockSharePointClient', mockClient],
])) {
  describe(`${name}: Forms`, () => {
    test('a created Form reads back exactly as it was written', async () => {
      const client = makeClient();
      const created = await client.createFormItem(oneToOne, newForm());
      const read = await client.getFormItem(oneToOne, created.id);

      assert.ok(read);
      assert.deepEqual(read.problems, []);
      assert.ok(read.etag);
      assert.equal(read.etag, created.etag);
      for (const [column, value] of Object.entries(newForm())) {
        assert.deepEqual(read.fields[column], value, column);
      }
    });

    test('a read holds every column the Form Type reads, unwritten ones empty', async () => {
      const client = makeClient();
      const { id } = await client.createFormItem(oneToOne, newForm());
      const read = await client.getFormItem(oneToOne, id);
      const written = newForm();

      for (const [column, kind] of formColumnKinds(oneToOne)) {
        if (column in written) continue;
        const empty =
          kind === 'encoded' ? (column === 'Actions' ? [] : '') : null;
        assert.deepEqual(read?.fields[column], empty, column);
      }
    });

    test('a write changes only the columns it names and moves the ETag on', async () => {
      const client = makeClient();
      const created = await client.createFormItem(oneToOne, newForm());

      const result = await client.patchFormItem(
        oneToOne,
        created.id,
        { Wellbeing: 'Better now ✅', CompetencyStage: 'Exceeding' },
        created.etag
      );

      assert.equal(result.ok, true);
      assert.ok(result.ok && result.data);
      const data = result.ok ? result.data : null;
      assert.notEqual(data?.etag, created.etag);
      assert.equal(data?.fields.Wellbeing, 'Better now ✅');
      assert.equal(data?.fields.CompetencyStage, 'Exceeding');
      assert.equal(data?.fields.Agenda, newForm().Agenda);
      assert.deepEqual(data?.fields.Employee, SAM);
    });

    test('a write against a stale ETag is a 412 and changes nothing', async () => {
      const client = makeClient();
      const created = await client.createFormItem(oneToOne, newForm());
      await client.patchFormItem(
        oneToOne,
        created.id,
        { Agenda: 'first' },
        created.etag
      );

      const result = await client.patchFormItem(
        oneToOne,
        created.id,
        { Agenda: 'second' },
        created.etag
      );

      assert.deepEqual(result, { ok: false, status: 412 });
      const read = await client.getFormItem(oneToOne, created.id);
      assert.equal(read?.fields.Agenda, 'first');
    });

    test('clearing a person, a date, text and the Actions empties each', async () => {
      const client = makeClient();
      const created = await client.createFormItem(oneToOne, newForm());
      const result = await client.patchFormItem(
        oneToOne,
        created.id,
        { FirstLineManager: null, MeetingDate: '', Agenda: '', Actions: [] },
        created.etag
      );

      assert.equal(result.ok, true);
      const fields = result.ok ? result.data?.fields : {};
      assert.equal(fields?.FirstLineManager, null);
      assert.equal(fields?.MeetingDate, null);
      assert.equal(fields?.Agenda, '');
      assert.deepEqual(fields?.Actions, []);
    });

    test('a write naming a column the Form Type does not read is refused before anything is stored', async () => {
      const client = makeClient();
      await assert.rejects(
        client.createFormItem(oneToOne, { ...newForm(), Salary: '1' }),
        /no column "Salary"/
      );
      assert.deepEqual((await client.listFormItems(oneToOne)).items, []);
    });

    test('a fourth Form Action is refused rather than stored', async () => {
      const client = makeClient();
      const created = await client.createFormItem(oneToOne, newForm());
      const action = /** @type {any[]} */ (newForm().Actions)[0];
      await assert.rejects(
        client.patchFormItem(
          oneToOne,
          created.id,
          { Actions: [action, action, action, action] },
          created.etag
        ),
        /more than 3/
      );
      const read = await client.getFormItem(oneToOne, created.id);
      assert.deepEqual(read?.fields.Actions, newForm().Actions);
    });

    test('a Form that does not exist reads as null and cannot be written', async () => {
      const client = makeClient();
      assert.equal(await client.getFormItem(oneToOne, '404'), null);
      assert.deepEqual(
        await client.patchFormItem(oneToOne, '404', { Agenda: 'x' }, '"1"'),
        { ok: false, status: 404 }
      );
    });

    test('a column edited by hand in the list reads back raw and is reported', async () => {
      const seed = stored('7', { Employee: SAM, Agenda: 'fine' });
      seed.fields.Wellbeing = 'typed straight into the list';
      const client = makeClient({ seed: [seed] });

      const read = await client.getFormItem(oneToOne, '7');

      assert.equal(read?.fields.Agenda, 'fine');
      assert.equal(read?.fields.Wellbeing, 'typed straight into the list');
      assert.deepEqual(read?.problems, [
        {
          column: 'Wellbeing',
          problem: 'is not encoded',
          raw: 'typed straight into the list',
        },
      ]);
    });

    test('free text is never stored as it was typed', async () => {
      const client = makeClient();
      const { id } = await client.createFormItem(oneToOne, newForm());
      const seenInList = listHolds.get(client)?.(id, 'Agenda');
      assert.equal(seenInList, encodeText(String(newForm().Agenda)));
    });
  });
}

// --- Http: the exact wire ------------------------------------------------

test('HttpSharePointClient: a Form read names the prefixed list, every column, and each person’s login and name', async () => {
  const { fetch, calls } = formBackend({ listPrefix: 'uat_' });
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    listPrefix: 'uat_',
    fetchImpl: fetch,
  });

  await client.listFormItems(oneToOne);

  const url = decodeURIComponent(calls[0].url);
  assert.match(url, /getbytitle\('uat_OneToOne'\)\/items\?/);
  const select = /\$select=([^&]*)/.exec(url)?.[1].split(',') ?? [];
  const expand = /\$expand=([^&]*)/.exec(url)?.[1].split(',') ?? [];
  for (const [column, kind] of formColumnKinds(oneToOne)) {
    if (kind === 'person') {
      assert.ok(select.includes(`${column}/Name`), column);
      assert.ok(select.includes(`${column}/Title`), column);
      assert.ok(expand.includes(column), column);
    } else {
      assert.ok(select.includes(column), column);
    }
  }
  for (const stamp of ['Id', 'Created', 'Modified']) {
    assert.ok(select.includes(stamp), stamp);
  }
});

test('HttpSharePointClient: a Form write sends people by id, dates as the start of the day, and text encoded, guarded by If-Match', async () => {
  const { fetch, calls } = formBackend();
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });
  const created = await client.createFormItem(oneToOne, newForm());

  await client.patchFormItem(
    oneToOne,
    created.id,
    {
      FirstLineManager: JO,
      SecondLineManager: null,
      MeetingDate: '2026-11-02',
      Wellbeing: 'Feeling good £ ✅',
      CompetencyStage: '',
    },
    created.etag
  );

  const patch = calls.find((c) => c.method === 'PATCH');
  assert.equal(patch?.headers['if-match'], created.etag);
  assert.deepEqual(JSON.parse(String(patch?.body)), {
    FirstLineManagerId: 3,
    SecondLineManagerId: null,
    MeetingDate: startOfLocalDay('2026-11-02').toISOString(),
    Wellbeing: 'RmVlbGluZyBnb29kIMKjIOKchQ==',
    CompetencyStage: null,
  });
});

test('HttpSharePointClient: a failed Form write is a status, never a throw', async () => {
  for (const status of [500, 403]) {
    const { fetch } = makeFetch([
      {
        when: (c) => c.url.endsWith('/_api/contextinfo'),
        respond: () =>
          new Response(JSON.stringify({ FormDigestValue: 'd' }), {
            status: 200,
          }),
      },
      { when: () => true, respond: () => new Response('', { status }) },
    ]);
    const client = new HttpSharePointClient({
      webUrl: WEB_URL,
      fetchImpl: fetch,
    });
    assert.deepEqual(
      await client.patchFormItem(oneToOne, '1', { Agenda: 'x' }, '"1"'),
      { ok: false, status }
    );
  }
});

test('HttpSharePointClient: a create the list answers without an id is an error', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.url.endsWith('/_api/contextinfo'),
      respond: () =>
        new Response(JSON.stringify({ FormDigestValue: 'd' }), { status: 200 }),
    },
    {
      when: (c) => c.method === 'POST',
      respond: () => new Response(JSON.stringify({}), { status: 201 }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });
  await assert.rejects(
    client.createFormItem(oneToOne, { Agenda: 'x' }),
    /returned no id/
  );
});

test('HttpSharePointClient: a create whose item cannot then be read is an error, not a blank Form', async () => {
  const { fetch } = makeFetch([
    {
      when: (c) => c.url.endsWith('/_api/contextinfo'),
      respond: () =>
        new Response(JSON.stringify({ FormDigestValue: 'd' }), { status: 200 }),
    },
    {
      when: (c) => c.method === 'POST',
      // The verbose OData shape some farms still answer with.
      respond: () =>
        new Response(JSON.stringify({ d: { Id: 5 } }), { status: 201 }),
    },
    { when: () => true, respond: () => new Response('', { status: 404 }) },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });
  await assert.rejects(
    client.createFormItem(oneToOne, { Agenda: 'x' }),
    /could not be read back/
  );
});

test('HttpSharePointClient: a list answer with no rows reads as no Forms', async () => {
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: async () => new Response(JSON.stringify({}), { status: 200 }),
  });
  assert.deepEqual(await client.listFormItems(oneToOne, { top: 10 }), {
    items: [],
    next: null,
  });
});

test('HttpSharePointClient: a stored Form missing its stamps and names reads with them empty', async () => {
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          Id: 9,
          Employee: { Name: 'i:0#.w|corp\\sam' },
          DueDate: 20261031,
        }),
        { status: 200 }
      ),
  });
  const read = await client.getFormItem(oneToOne, '9');
  assert.equal(read?.etag, '');
  assert.equal(read?.created, null);
  assert.equal(read?.modified, null);
  assert.deepEqual(read?.fields.Employee, {
    loginName: 'sam',
    displayName: '',
  });
  assert.equal(read?.fields.DueDate, null);
});

test('HttpSharePointClient: a read that fails for any reason but a missing item rejects', async () => {
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: async () => new Response('', { status: 500 }),
  });
  await assert.rejects(client.getFormItem(oneToOne, '1'), /500/);
});

/**
 * The decoded `$filter` and `$orderby` of one list read.
 *
 * @param {import('../src/sharepoint-client.js').ListFormItemsOptions} opts
 */
async function formQuery(opts) {
  const { fetch, calls } = formBackend();
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });
  await client.listFormItems(oneToOne, opts);
  const url = decodeURIComponent(
    String(calls.find((c) => c.url.includes('/items?'))?.url)
  );
  return {
    filter: /\$filter=([^&]*)/.exec(url)?.[1] ?? null,
    orderby: /\$orderby=([^&]*)/.exec(url)?.[1] ?? null,
    top: /\$top=([^&]*)/.exec(url)?.[1] ?? null,
  };
}

test('HttpSharePointClient: "involving" matches the person as the Employee or either current manager', async () => {
  const { filter } = await formQuery({ filter: { involving: 'ana' } });
  assert.equal(
    filter,
    '(EmployeeId eq 2 or CurrentFirstLineManagerId eq 2 or CurrentSecondLineManagerId eq 2)'
  );
});

test('HttpSharePointClient: a person who cannot be resolved rejects the read rather than widening it', async () => {
  const { fetch } = formBackend();
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });
  await assert.rejects(
    client.listFormItems(oneToOne, { filter: { involving: 'nobody' } })
  );
});

test('HttpSharePointClient: closed means a closing Status, open includes a Form with none yet', async () => {
  assert.equal(
    (await formQuery({ filter: { closed: true } })).filter,
    "(Status eq 'Completed' or Status eq 'Void' or Status eq 'Cancelled')"
  );
  assert.equal(
    (await formQuery({ filter: { closed: false } })).filter,
    "(Status eq null or (Status ne 'Completed' and Status ne 'Void' and Status ne 'Cancelled'))"
  );
});

test('HttpSharePointClient: a date window covers both whole days it names', async () => {
  const { filter } = await formQuery({
    filter: {
      window: { column: 'DueDate', from: '2026-10-01', to: '2026-10-31' },
    },
  });
  assert.equal(
    filter,
    `DueDate ge '${startOfLocalDay('2026-10-01').toISOString()}' and ` +
      `DueDate lt '${startOfLocalDay('2026-11-01').toISOString()}'`
  );
});

test('HttpSharePointClient: an ordering breaks ties on Id in the same direction', async () => {
  assert.equal(
    (await formQuery({ orderBy: { column: 'DueDate' } })).orderby,
    'DueDate,Id'
  );
  assert.equal(
    (await formQuery({ orderBy: { column: 'Modified', dir: 'desc' } })).orderby,
    'Modified desc,Id desc'
  );
});

test('HttpSharePointClient: a page size reads one page and hands back SharePoint’s own next link', async () => {
  const next = `${WEB_URL}/_api/web/lists/getbytitle('OneToOne')/items?$skiptoken=Paged%3dTRUE%26p_ID%3d2&$top=2`;
  const { fetch, calls } = makeFetch([
    {
      when: (c) => c.url.includes('skiptoken'),
      respond: () =>
        new Response(JSON.stringify({ value: [{ Id: 3 }] }), { status: 200 }),
    },
    {
      when: (c) => c.method === 'GET',
      respond: () =>
        new Response(
          JSON.stringify({
            value: [{ Id: 1 }, { Id: 2 }],
            'odata.nextLink': next,
          }),
          { status: 200 }
        ),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });

  const first = await client.listFormItems(oneToOne, { top: 2 });
  assert.deepEqual(
    first.items.map((i) => i.id),
    ['1', '2']
  );
  assert.equal(first.next, next);
  assert.match(decodeURIComponent(calls[0].url), /\$top=2/);

  const second = await client.listFormItems(oneToOne, { next: first.next });
  assert.deepEqual(
    second.items.map((i) => i.id),
    ['3']
  );
  assert.equal(second.next, null);
  assert.equal(calls[1].url, next);
});

// --- Both clients: what a query may name ----------------------------------

for (const [name, makeClient] of /** @type {const} */ ([
  ['HttpSharePointClient', httpClient],
  ['MockSharePointClient', mockClient],
])) {
  test(`${name}: an encoded column cannot be filtered or ordered on`, async () => {
    const client = makeClient();
    await assert.rejects(
      client.listFormItems(oneToOne, { orderBy: { column: 'Agenda' } }),
      /cannot be queried on the column "Agenda"/
    );
    await assert.rejects(
      client.listFormItems(oneToOne, {
        filter: { window: { column: 'Status' } },
      }),
      /cannot be queried on the column "Status"/
    );
    await assert.rejects(
      client.listFormItems(oneToOne, { orderBy: { column: 'Nope' } }),
      /cannot be queried on the column "Nope"/
    );
  });
}

// --- Mock: the query semantics the Http query asks the server for --------

/** The seed every mock query test reads: four Forms with known people and dates. */
function querySeed() {
  return [
    stored('1', {
      Employee: SAM,
      CurrentFirstLineManager: ANA,
      CurrentSecondLineManager: JO,
      Status: 'Pending',
      DueDate: '2026-10-05',
    }),
    stored('2', {
      Employee: SAM,
      CurrentFirstLineManager: ANA,
      Status: null,
      DueDate: '2026-10-31',
    }),
    stored('3', {
      Employee: SAM,
      CurrentFirstLineManager: ANA,
      Status: 'Completed',
      DueDate: '2026-10-05',
    }),
    stored('4', {
      Employee: ANA,
      CurrentFirstLineManager: JO,
      Status: 'Void',
      DueDate: null,
    }),
  ];
}

/** @param {import('../src/sharepoint-client.js').ListFormItemsOptions} opts */
async function mockIds(opts) {
  const client = mockClient({ seed: querySeed() });
  const { items } = await client.listFormItems(oneToOne, opts);
  return items.map((item) => item.id);
}

test('MockSharePointClient: "involving" returns the Forms a person is the Employee or a current manager on', async () => {
  assert.deepEqual(await mockIds({ filter: { involving: 'JO' } }), ['1', '4']);
  assert.deepEqual(await mockIds({ filter: { involving: 'sam' } }), [
    '1',
    '2',
    '3',
  ]);
  assert.deepEqual(await mockIds({ filter: { involving: 'nobody' } }), []);
});

test('MockSharePointClient: open and closed split on the closing Statuses, a Form with none being open', async () => {
  assert.deepEqual(await mockIds({ filter: { closed: false } }), ['1', '2']);
  assert.deepEqual(await mockIds({ filter: { closed: true } }), ['3', '4']);
});

test('MockSharePointClient: a date window includes both days it names and never a Form with no date', async () => {
  assert.deepEqual(
    await mockIds({
      filter: {
        window: { column: 'DueDate', from: '2026-10-05', to: '2026-10-05' },
      },
    }),
    ['1', '3']
  );
  assert.deepEqual(
    await mockIds({
      filter: { window: { column: 'DueDate', from: '2026-10-06' } },
    }),
    ['2']
  );
  assert.deepEqual(
    await mockIds({
      filter: { window: { column: 'Created', to: '2026-09-01' } },
    }),
    ['1', '2', '3', '4']
  );
});

test('MockSharePointClient: an ordering breaks ties on Id in the same direction, a Form with no value first', async () => {
  assert.deepEqual(await mockIds({ orderBy: { column: 'DueDate' } }), [
    '4',
    '1',
    '3',
    '2',
  ]);
  assert.deepEqual(
    await mockIds({ orderBy: { column: 'DueDate', dir: 'desc' } }),
    ['2', '3', '1', '4']
  );
  assert.deepEqual(await mockIds({ orderBy: { column: 'Employee' } }), [
    '4',
    '1',
    '2',
    '3',
  ]);
});

test('MockSharePointClient: a page size pages through every Form once', async () => {
  const client = mockClient({ seed: querySeed() });
  /** @type {string[]} */
  const seen = [];
  /** @type {string | null | undefined} */
  let next;
  do {
    const page = await client.listFormItems(oneToOne, {
      top: 3,
      orderBy: { column: 'DueDate' },
      ...(next ? { next } : {}),
    });
    seen.push(...page.items.map((item) => item.id));
    next = page.next;
  } while (next);
  assert.deepEqual(seen, ['4', '1', '3', '2']);
});

test('MockSharePointClient: the Forms it is handed are copied, so writes never reach the fixture', async () => {
  const seed = querySeed();
  const before = structuredClone(seed);
  const client = mockClient({ seed });
  const read = await client.getFormItem(oneToOne, '1');
  await client.patchFormItem(
    oneToOne,
    '1',
    { Agenda: 'x' },
    String(read?.etag)
  );
  await client.createFormItem(oneToOne, { Agenda: 'y' });
  assert.deepEqual(seed, before);
});

test('MockSharePointClient: a list read is cancelled with the mount that issued it', async () => {
  const client = mockClient({ seed: querySeed() });
  const controller = new AbortController();
  const bound = withAbortSignal(client, controller.signal);
  const pending = bound.listFormItems(oneToOne);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});

test('every dev fixture Form reads back with no problems', async () => {
  const client = new MockSharePointClient({ personas: {}, formLists });
  for (const definition of APP_CONFIG.formTypes) {
    const { items } = await client.listFormItems(definition);
    for (const item of items) assert.deepEqual(item.problems, [], item.id);
  }
});
