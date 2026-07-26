# SharePointClient Interface

The `client` is an explicit dependency: a route passes it into a function
component as a plain argument (`SomePage({ client, … })`), and the component
calls `client.getCase(…)` / `client.patchCase(…)` directly. No class component,
lifecycle callback, or custom element is needed to read or write SharePoint —
just the function and the `client` it was handed.

## Quick reference

```js
// The interface (src/sharepoint-client.js):
// getCase(id) → Promise<CaseRow | null>
// patchCase(id, fields, etag) → Promise<PatchResult>
// listCases(filter) → Promise<CaseRow[]>
// getCurrentUser() → Promise<CurrentUser>
// getCurrentUserGroups() → Promise<string[]>

// Switch to mock mode: ?mock=1 in the URL
// Add a new method: typedef → HttpSharePointClient → MockSharePointClient → fixture
```

---

## The interface contract

Every REST consumer in the framework codes against the `SharePointClient` typedef defined in `src/sharepoint-client.js`. Both `HttpSharePointClient` (real HTTP) and `MockSharePointClient` (in-memory fixture) implement it identically. Components receive a `client` property; they never know or care which implementation is behind it.

This is what makes the mock-first dev loop work: the same component code runs against real SharePoint in production and against fixture data in development and tests.

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
 * id: string,
 * caseType: string,
 * title: string,
 * status: 'In-progress' | 'Actions In Progress' | 'Completed',
 * assignedReviewer: string,
 * responsibleParty: string,
 * answers: Record<string, Answer>,
 * conversation: Message[],
 * notes: string,
 * reportableAt?: string | null,
 * remediationDueDate?: string | null,
 * completedAt: string | null,
 * amendedOutcome?: AmendedOutcome | null,
 * etag: string
 * }} CaseRow
 */
```

The full shape (the `Effective*` reporting columns, `Appeals`, etc.) lives in `src/sharepoint-client.js`; the fields above are the storage-relevant subset. `status` widened to three values with the lifecycle change; `reportableAt` / `remediationDueDate` are stamped at Send Actions; `amendedOutcome` carries Controls' post-completion verdict and **replaces the removed `overrides[]` blob**. See the [provisioning runbook](provisioning-runbook.md) for the SharePoint columns behind each field.

`answers` and `conversation` are stored as JSON blobs in the SharePoint list. `HttpSharePointClient` handles the serialisation/deserialisation; consumers always receive and send parsed JS objects.

### `Answer`

```js
/**
 * @typedef {{ value: string | string[], justification?: string, capture?: Record<string, string | { loginName: string, displayName: string } | Array<string | RemediationAction>> }} Answer
 */
```

A **Remediation Action** the Reviewer selected on a failed Answer is `{ id, text }` in `answer.remediationActions`; how that Answer's remediation ended up is `answer.remediationStatus` (ADR-0037). The `{ id, text, status, cancelReason? }` shape in an `actions`-typed Issue Capture Field value is ADR-0024's retired store: no Case Type declares one and nothing reads it any more (#497).

`value` is a plain string for `yes-no-na` and `single-choice` questions; a `string[]` for `multi-choice`. An empty array means unanswered.

---

## Adding a new method

Follow these four steps:

### 1. Extend the typedef in `src/sharepoint-client.js`

```js
/**
 * @typedef {{
 * …existing methods…,
 * getMyNewThing: (arg: string) => Promise<MyThing | null>
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
 return item ? {...item }: null;
}
```

Seed `this._myThings` from a fixture array passed via the constructor.

### 4. Add fixture data

Add representative records to the appropriate file under `dev/fixtures/` and wire them into `MockSharePointClient` construction in `src/services/create-sharepoint-client.js`.

---

## Worked example: adding `listMyThings`

```js
// src/sharepoint-client.js (new typedef)
/**
 * @typedef {{ id: string, label: string }} MyThing
 */

// Add to the SharePointClient typedef:
// listMyThings: () => Promise<MyThing[]>
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
 return this._myThings.map(t => ({...t }));
}
```

```js
// dev/fixtures/my-things.js
export const myThings = [
  { id: '1', label: 'Thing A' },
  { id: '2', label: 'Thing B' },
];
```
