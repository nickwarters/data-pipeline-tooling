// @ts-check
/** @typedef {{ method: string, url: string, headers: Record<string, string>, body: string|null }} CapturedCall */

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
