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
// listCases(filter, { listName, top, skip, orderBy, orderDir }) → Promise<CaseRow[]>
// getCurrentUser() → Promise<CurrentUser>
// getCurrentUserGroups() → Promise<string[]>
// searchPeople(query) → Promise<PersonResult[]>
// resolveUsers(accountNames) → Promise<Record<string, string | null>>
// resolveManagers(accountNames) → Promise<Record<string, string | null>>

// Switch to mock mode: ?mock=1 in the URL
// Add a new method: typedef → HttpSharePointClient → MockSharePointClient → fixture
```

---

## The interface contract

Every REST consumer in the framework codes against the `SharePointClient` typedef defined in `src/sharepoint-client.js`. Both `HttpSharePointClient` (real HTTP) and `MockSharePointClient` (in-memory fixture) implement it identically. Components receive a `client` property; they never know or care which implementation is behind it.

This is what makes the mock-first dev loop work: the same component code runs against real SharePoint in production and against fixture data in development and tests.

`resolveUsers` returns authoritative display names. `resolveManagers` reads the
same User Profile Service `GetPropertiesFor` response and returns each profile's
Manager as a lower-cased bare account name. Both methods return an own key for
every requested account; an unresolved profile or absent Manager property is
`null`. The mock directory models the same edge with an optional `manager` field
on a fixture person, which is private metadata and never appears in
`searchPeople` results.

### `searchPeople(query)`

The directory type-ahead behind every people picker. A blank or whitespace-only
query short-circuits to `[]` without a request. Otherwise it POSTs to the
people-picker endpoint across all principal sources, so it finds users who have
never been added to this site, and reduces each result's claims `Key` to a bare
account name.

The shared debounced search reports `loading` when its 200ms timer starts the
request, not when the query is scheduled. A query replaced during that window
produces neither a loading state nor a directory request.

It **rejects** on a response whose payload it cannot read as an entity list,
naming the endpoint and the payload's top-level keys — keys only, never values,
which are directory records. Returning `[]` there would be indistinguishable on
screen from a directory that genuinely matched nobody, which is exactly how a
broken request went unnoticed once. Callers are expected to have a failure path:
`createDebouncedPeopleSearch` turns a rejection into an `error` search state and
the picker says the search is unavailable.

---

## Running in mock mode

Append `?mock=1` to any URL. `src/services/create-sharepoint-client.js` reads this flag and returns a `MockSharePointClient` seeded from `dev/fixtures/`.

```
http://localhost:1234/SitePages/app.aspx?mock=1#/dashboard
```

The mock client operates entirely in memory. `patchCase` writes to its internal array so that subsequent `getCase` calls return the updated row within the same page load.

### Published Question Bank versions in mock mode

A Case past the reportable milestone resolves its questions from the Question
Bank version stamped on its row, not from today's bank (ADR-0021). The mock
serves those versions from
[`dev/fixtures/question-bank-versions.js`](../../dev/fixtures/question-bank-versions.js),
which supplies both halves of `buildQuestionBankVersions()`:

| Version                                    | Built how                                                                  | Why                                                                                                                                                         |
| ------------------------------------------ | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Older versions (`PUBLISHED_BANK_VERSIONS`) | Literal exports with literal hashes                                        | A frozen version must not move when someone edits the live bank, or a Case stamped against it shows today's content while claiming January's                |
| Current version                            | Compiled from the live `case-types/banks/{slug}.txt` via `compileExport()` | "Current" means the newest published version and the bank on screen are the same content; it is also what `getExportHash()` returns for completion to stamp |

Two fixture Cases — `complaints-frozen-v1` and `complaints-frozen-v2` — carry a
`questionBankVersion` and open against those older catalogues. The January one
answers a question retired since, which no other Case can display. Their Answers
name only the ids their own version asks, so the live-bank fixture contracts in
`tests/complaints.test.js` deliberately skip any Case carrying a
`questionBankVersion`; the frozen Cases are held to the same rules against the
version they name, in `tests/question-bank-versions-fixture.test.js`.

A Case completed in the dev loop stamps the compiled current hash and re-opens
against it. Stamping a hash the fixture does not serve is not a hard failure —
the Case falls back to the live bank behind an "as-reviewed version unavailable"
banner — which is precisely why that wiring is covered by tests.

---

## Data shapes

### `CaseRow`

```js
/**
 * @typedef {{
 * id: string,
 * caseType: string,
 * title: string,
 * status: 'In-progress' | 'Actions In Progress' | 'Completed' | 'Void',
 * assignedReviewer: string,
 * assignedAt?: string | null,
 * responsibleParty: string,
 * answers: Record<string, Answer>,
 * conversation: Message[],
 * notes: string,
 * reportableAt?: string | null,
 * remediationDueDate?: string | null,
 * completedAt: string | null,
 * voidReason?: string | null,
 * voidedAt?: string | null,
 * voidedBy?: string | null,
 * amendedOutcome?: AmendedOutcome | null,
 * etag: string
 * }} CaseRow
 */
```

The full shape (the `Effective*` reporting columns, `Appeals`, etc.) lives in `src/sharepoint-client.js`; the fields above are the storage-relevant subset. `status` widened to three values with the lifecycle change; `reportableAt` / `remediationDueDate` are stamped at Send Actions; `amendedOutcome` carries Controls' post-completion verdict and **replaces the removed `overrides[]` blob**. The client stamps `assignedAt` itself on every write that sets `assignedReviewer` (and clears it when the Reviewer is cleared), so no caller stamps it. See the [Case Type onboarding checklist](../case-type-onboarding.md) for the SharePoint columns behind each field.

`answers` and `conversation` are stored as JSON blobs in the SharePoint list. `HttpSharePointClient` handles the serialisation/deserialisation; consumers always receive and send parsed JS objects.

### Case list scope and row filters

`CaseListOptions.listName` selects the Case Type's SharePoint list. A Case Type
has one list, so every Case read supplies that option explicitly; it is the
scope of the read, not a row predicate.

`ListCasesFilter` contains only predicates on rows in that list, such as
`status`, `assignedReviewer`, `completedAfter`, and `titlePrefix`. It has no
`caseType` field. `CaseRow.caseType` remains returned row data and can be used
for display, grouping, and downstream role decisions.

```js
const rows = await client.listCases(
  { status: 'In-progress', titlePrefix: 'CR-1' },
  { listName: 'Cases-Complaints' }
);
```

Search and Team Cases may accept a `caseType` value in their own service or
URL state to choose which source lists to query. Those services translate that
selection into `listName`; they do not pass it as a `ListCasesFilter` field.

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

Seed `this._myThings` from a fixture array passed via the constructor. Keep
fixture-only metadata private to the mock implementation: directory people may
have a `manager` edge used by `resolveManagers`, while `searchPeople` still
returns only `PersonResult` fields.

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
