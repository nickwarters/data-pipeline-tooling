// @ts-check
import { HttpSharePointClient } from '../../src/services/http-sharepoint-client.js';

/** @typedef {{ method: string, url: string, headers: Record<string, string>, body: string|null }} CapturedCall */

/**
 * @typedef {Object} PersonColumn
 * @property {string} field
 * @property {string} column
 * @property {string} idColumn
 * @property {''|null} clearValue
 * @property {''|undefined} emptyValue
 */

/** @type {PersonColumn[]} */
export const PERSON_COLUMNS = [
  {
    field: 'assignedReviewer',
    column: 'AssignedReviewer',
    idColumn: 'AssignedReviewerId',
    clearValue: '',
    emptyValue: '',
  },
  {
    field: 'responsibleParty',
    column: 'ResponsibleParty',
    idColumn: 'ResponsiblePartyId',
    clearValue: '',
    emptyValue: '',
  },
  {
    field: 'assignedReviewerManager',
    column: 'AssignedReviewerManager',
    idColumn: 'AssignedReviewerManagerId',
    clearValue: null,
    emptyValue: undefined,
  },
  {
    field: 'responsiblePartyManager',
    column: 'ResponsiblePartyManager',
    idColumn: 'ResponsiblePartyManagerId',
    clearValue: null,
    emptyValue: undefined,
  },
  {
    field: 'voidedBy',
    column: 'VoidedBy',
    idColumn: 'VoidedById',
    clearValue: null,
    emptyValue: undefined,
  },
];

/**
 * Build a fake fetch that returns the response for the first matching rule.
 * Every request is recorded for protocol assertions.
 *
 * @param {Array<{ when: (call: CapturedCall) => boolean, respond: () => Response }>} responses
 * @returns {{ fetch: (input: RequestInfo|URL, init?: RequestInit) => Promise<Response>, calls: CapturedCall[] }}
 */
export function makeFetch(responses) {
  /** @type {CapturedCall[]} */
  const calls = [];
  return {
    calls,
    async fetch(input, init = {}) {
      const url = typeof input === 'string' ? input : input.toString();
      const method = (init.method ?? 'GET').toUpperCase();
      /** @type {Record<string, string>} */
      const headers = {};
      const h = init.headers;
      if (h) {
        if (h instanceof Headers) {
          h.forEach((value, key) => {
            headers[key.toLowerCase()] = value;
          });
        } else if (Array.isArray(h)) {
          for (const [key, value] of h)
            headers[key.toLowerCase()] = String(value);
        } else {
          for (const key of Object.keys(h))
            headers[key.toLowerCase()] = String(/** @type {any} */ (h)[key]);
        }
      }
      const body = init.body == null ? null : String(init.body);
      /** @type {CapturedCall} */
      const call = { method, url, headers, body };
      calls.push(call);
      for (const response of responses) {
        if (response.when(call)) return response.respond();
      }
      throw new Error(`No fake fetch rule matched: ${method} ${url}`);
    },
  };
}

/**
 * Build a fake sleep that records every delay it was asked to wait.
 * @returns {{ sleep: (ms: number) => Promise<void>, delays: number[] }}
 */
export function makeSleep() {
  /** @type {number[] } */
  const delays = [];
  return {
    delays,
    async sleep(ms) {
      delays.push(ms);
    },
  };
}

/** @param {string} digest */
export function digestResponse(digest) {
  return new Response(JSON.stringify({ FormDigestValue: digest }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * @param {string} displayName
 * @param {string} [manager]
 */
export function profileResponse(displayName, manager) {
  return new Response(
    JSON.stringify({
      DisplayName: displayName,
      UserProfileProperties:
        manager === undefined ? [] : [{ Key: 'Manager', Value: manager }],
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

/**
 * A complete SharePoint Case payload with fresh required fields on every call.
 * Optional fields stay absent unless the test is exercising them.
 *
 * @param {Record<string, unknown>} [overrides]
 */
export function caseRowResponse(overrides = {}) {
  return {
    Id: 'case-1',
    Title: 'Case 1',
    Status: 'In-progress',
    CaseType: 'example-review',
    Answers: '{}',
    Conversation: '[]',
    ...overrides,
  };
}

/**
 * A client whose reads return one Case or one page of Cases.
 *
 * @param {...Record<string, unknown>} rows
 */
export function readsClient(...rows) {
  return new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      const body = url.includes('/items(') ? rows[0] : { value: rows };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
}

/** A client whose Case-list reads return an empty page. */
export function emptyPageClient() {
  const { fetch, calls } = makeFetch([
    {
      when: (call) => call.method === 'GET',
      respond: () =>
        new Response(JSON.stringify({ value: [] }), { status: 200 }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
  });
  return {
    client,
    calls,
    lastUrl: () => calls.at(-1)?.url ?? '',
  };
}

/** @param {number} id */
export function ensureUserResponse(id) {
  return new Response(JSON.stringify({ Id: id, Title: 'John Smith' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * A client backing a Person-column write, with its protocol calls exposed.
 *
 * @param {Response | ((call: CapturedCall) => Response) | null} [ensured]
 * @param {{ now?: () => Date, row?: Record<string, unknown> }} [options]
 */
export function personWriteClient(
  ensured = ensureUserResponse(14),
  { now, row = {} } = {}
) {
  /** @type {CapturedCall | null} */
  let ensureCall = null;
  const { fetch, calls } = makeFetch([
    {
      when: (call) => call.url.endsWith('/_api/contextinfo'),
      respond: () => digestResponse('d'),
    },
    {
      when: (call) => {
        if (!call.url.endsWith('/_api/web/ensureuser')) return false;
        ensureCall = call;
        return true;
      },
      respond: () =>
        (typeof ensured === 'function'
          ? ensured(/** @type {CapturedCall} */ (ensureCall))
          : ensured) ?? new Response('no such user', { status: 500 }),
    },
    {
      when: (call) => call.method === 'PATCH',
      respond: () =>
        new Response(null, { status: 204, headers: { ETag: '"v2"' } }),
    },
    {
      when: (call) => call.method === 'GET',
      respond: () =>
        new Response(JSON.stringify(caseRowResponse(row)), {
          status: 200,
          headers: { ETag: '"v2"' },
        }),
    },
  ]);
  const client = new HttpSharePointClient({
    webUrl: WEB_URL,
    fetchImpl: fetch,
    now,
  });
  return { client, calls };
}

/**
 * A fake backing a filter that names people: the form digest, an EnsureUser
 * answering from `ids` (keyed by bare account), and the items GET the query
 * itself issues. An account `ids` does not name cannot be resolved, which is
 * how a directory miss is spelled.
 *
 * @param {Record<string, number>} ids
 * @param {() => Response} [items] the items response, defaulting to an empty page
 */
export function peopleFilterFetch(ids, items) {
  /** @type {CapturedCall | null} */
  let ensureCall = null;
  return makeFetch([
    {
      when: (c) => c.url.endsWith('/_api/contextinfo'),
      respond: () =>
        new Response(JSON.stringify({ FormDigestValue: 'd' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    },
    {
      when: (c) => {
        if (!c.url.endsWith('/_api/web/ensureuser')) return false;
        ensureCall = c;
        return true;
      },
      respond: () => {
        const logon = String(JSON.parse(String(ensureCall?.body)).logonName);
        const id = ids[logon.slice(logon.lastIndexOf('\\') + 1)];
        if (id === undefined)
          return new Response('no such user', { status: 500 });
        return new Response(JSON.stringify({ Id: id }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
    {
      when: (c) => c.method === 'GET',
      respond:
        items ??
        (() => new Response(JSON.stringify({ value: [] }), { status: 200 })),
    },
  ]);
}

export const WEB_URL = 'https://sp.example.com/sites/casereview';
