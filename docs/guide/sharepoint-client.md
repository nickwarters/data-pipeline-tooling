# SharePointClient Interface

> TODO(simplify-ui): Reframe client usage as explicit dependencies passed into
> route shells and function components. The guide should avoid implying that
> authors need class components or lifecycle callbacks to perform SharePoint
> reads and writes.

## Quick reference

```js
// The interface (src/sharepoint-client.js):
// getCase(id)                          → Promise<CaseRow | null>
// patchCase(id, fields, etag)          → Promise<PatchResult>
// getQuestionDefinitions(ids)          → Promise<QuestionDefinition[]>
// listCases(filter)                    → Promise<CaseRow[]>
// getCurrentUser()                     → Promise<CurrentUser>
// getCurrentUserGroups()               → Promise<string[]>

// Switch to mock mode:  ?mock=1 in the URL
// Add a new method: typedef → HttpSharePointClient → MockSharePointClient → fixture
```

---

## The interface contract

Every REST consumer in the framework codes against the `SharePointClient` typedef defined in `src/sharepoint-client.js`. Both `HttpSharePointClient` (real HTTP) and `MockSharePointClient` (in-memory fixture) implement it identically. Components receive a `client` property; they never know or care which implementation is behind it.

This is what makes the mock-first dev loop work (ADR-0009): the same component code runs against real SharePoint in production and against fixture data in development and tests.

---

## Running in mock mode

Append `?mock=1` to any URL. `src/services/create-sharepoint-client.js` reads this flag and returns a `MockSharePointClient` seeded from `dev/fixtures/`.

```
http://localhost:1234/SitePages/app.aspx?mock=1#/dashboard
```

The mock client operates entirely in memory. `patchCase` writes to its internal array so that subsequent `getCase` calls return the updated row within the same page load.

---

## Data shapes

### `CaseRow`

```js
/**
 * @typedef {{
 *   id: string,
 *   caseType: string,
 *   title: string,
 *   status: 'In-progress' | 'Completed',
 *   assignedReviewer: string,
 *   responsibleParty: string,
 *   answers: Record<string, Answer>,
 *   conversation: Message[],
 *   notes: string,
 *   completedAt: string | null,
 *   etag: string
 * }} CaseRow
 */
```

`answers` and `conversation` are stored as JSON blobs in the SharePoint list (ADR-0007). `HttpSharePointClient` handles the serialisation/deserialisation; consumers always receive and send parsed JS objects.

### `Answer`

```js
/**
 * @typedef {{ value: string | string[], justification?: string, remediationActions?: Array<{id: string, text: string, completed: boolean}> }} Answer
 */
```

`value` is a plain string for `yes-no-na` and `single-choice` questions; a `string[]` for `multi-choice`. An empty array means unanswered.

---

## Adding a new method

Follow these four steps:

### 1. Extend the typedef in `src/sharepoint-client.js`

```js
/**
 * @typedef {{
 *   …existing methods…,
 *   getMyNewThing: (arg: string) => Promise<MyThing | null>
 * }} SharePointClient
 */
```

Add a corresponding `@typedef` for `MyThing` in the same file if it is a new shape.

### 2. Implement in `HttpSharePointClient`

```js
// src/services/http-sharepoint-client.js
/** @param {string} arg @returns {Promise<MyThing | null>} */
async getMyNewThing(arg) {
  const url = this._listItemUrl('MyList', arg);
  const res = await this._read(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`getMyNewThing ${arg} failed: ${res.status}`);
  const body = /** @type {Record<string, unknown>} */ (await res.json());
  return myThingFromItem(body);
}
```

Use `this._read(url)` for GETs and `this._write(url, 'PATCH', headers, body)` for writes. Never call `this._fetch` directly from a new method — `_read`/`_write` handle credentials, digest tokens, and throttle retry.

### 3. Implement in `MockSharePointClient`

```js
// src/services/mock-sharepoint-client.js
/** @param {string} arg @returns {Promise<MyThing | null>} */
async getMyNewThing(arg) {
  const item = this._myThings.find(t => t.id === arg);
  return item ? { ...item } : null;
}
```

Seed `this._myThings` from a fixture array passed via the constructor.

### 4. Add fixture data

Add representative records to the appropriate file under `dev/fixtures/` and wire them into `MockSharePointClient` construction in `src/services/create-sharepoint-client.js`.

---

## Worked example: adding `listMyThings`

```js
// src/sharepoint-client.js  (new typedef)
/**
 * @typedef {{ id: string, label: string }} MyThing
 */

// Add to the SharePointClient typedef:
//   listMyThings: () => Promise<MyThing[]>
```

```js
// src/services/http-sharepoint-client.js
/** @returns {Promise<import('../sharepoint-client.js').MyThing[]>} */
async listMyThings() {
  const items = await this._getAllPages(this._listItemsUrl('MyThings'));
  return items.map(raw => {
    const item = /** @type {Record<string, unknown>} */ (raw);
    return { id: String(item.Id ?? ''), label: String(item.Title ?? '') };
  });
}
```

```js
// src/services/mock-sharepoint-client.js
/** @returns {Promise<import('../sharepoint-client.js').MyThing[]>} */
async listMyThings() {
  return this._myThings.map(t => ({ ...t }));
}
```

```js
// dev/fixtures/my-things.js
export const myThings = [
  { id: '1', label: 'Thing A' },
  { id: '2', label: 'Thing B' },
];
```
