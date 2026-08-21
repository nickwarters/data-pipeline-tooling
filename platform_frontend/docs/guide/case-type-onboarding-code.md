# Onboarding a new Case Type — the manual, code-only walkthrough

This guide takes you from **nothing** to a **running dev harness** with a new
Case Type fully configured in code: visible on the dashboard, drawable through
allocation, scoped to its own user groups, seeded with example Cases, and
reviewable end to end in the Case Review page — all under `?mock=1`, with no
SharePoint involvement at any step.

It is deliberately the **manual** path. `scripts/scaffold_case_type.py`
(ADR-0028) automates most of these edits, but this document is the source of
truth for _what_ the scaffold does and _why_ each edit exists, so you can
onboard a type by hand, review a scaffold's output critically, or fix a
half-onboarded type. The SharePoint side (list provisioning, indexes, real
groups, ACLs, deployment) is intentionally out of scope — that lives in
[docs/case-type-onboarding.md](../case-type-onboarding.md).

Throughout, the worked example is a new **Widget Review** Case Type with the
slug `widget-review`. Substitute your own slug (kebab-case) and display name.

## Before you start

- Read [CONTEXT.md](../../CONTEXT.md). The domain terms there (`Case Type`,
  `Question Definition`, `Applicable Question`, `Answer`, `Outcome`,
  `Remediation Action`, `Reviewer`, `Responsible Party`, `Case Type Owner`)
  are used exactly, in code and in this guide.
- Get the dev harness running once with the existing `complaints` Case Type so
  you know what "working" looks like:

  ```sh
  npx serve .          # any static file server works
  # open http://localhost:3000/dev/?mock=1
  ```

- `npm install` so `npm run check` (tsc over JSDoc) and `node --test` run.

## The shape of a Case Type

A Case Type is not one file. It is a small constellation, each piece with one
job:

| Piece                  | File                                       | Job                                                                               |
| ---------------------- | ------------------------------------------ | --------------------------------------------------------------------------------- |
| Question Bank artifact | `case-types/banks/widget-review.txt`       | The reviewable content: Question Definitions, Outcome vocabulary, Labels          |
| Published bank version | `case-types/banks/widget-review.<hex>.txt` | Written by `node scripts/publish-bank.js`; what a reportable Case freezes against |
| Case Type module       | `case-types/widget-review.js`              | The operational config: list, groups, sections, SLA, appeal routing, outcome fn   |
| Registry entry         | `case-types/manifest.js`                   | THE one registration: slug, display name, lazy `import()`, bank thunk             |
| Dev personas           | `dev/fixtures/personas.js`                 | Mock users holding the new groups, selectable via `?asUser=`                      |
| Example Cases          | `dev/fixtures/cases.js`                    | Mock Case rows served by `MockSharePointClient` under `?mock=1`                   |
| Tests                  | `tests/widget-review.test.js`              | Contract tests for the catalogue, outcome function, and fixtures                  |

Two architectural facts explain the split:

1. **Config is code; content is data (ADR-0021).** The Case Type module is a
   JS module because `computeOutcome` is code and the section/appeal/SLA config
   is reviewed like code. The Question Bank is a separate JSON text artifact
   because it is _versionable content_ — in production it is hosted in the
   SharePoint Style Library and edited through the Question Bank editor page,
   not through pull requests.
2. **Everything is lazy and slug-keyed.** Nothing in the boot graph imports
   your module. The manifest maps slug → dynamic importer; eligibility,
   dashboards, allocation, and the Case Review page all discover your type at
   runtime from that registry plus the user's groups. Registering the slug is
   what makes the type exist.

Work through the steps in order — each one is verifiable before the next.

## Step 1 — Write the Question Bank artifact

Create `case-types/banks/widget-review.txt`. The extension is `.txt` **on
purpose**: SharePoint Subscription Edition has been unreliable at
storing/serving `.json` files (MIME/blocking issues), so bank artifacts are
plain JSON text in a `.txt` file, parsed explicitly by
`case-types/load-bank.js`. A repo-wide search for `*.json` will never find
them.

The file must satisfy the `QuestionBank` typedef in
[src/pages/question-bank/question-bank-source.js](../../src/pages/question-bank/question-bank-source.js):

```json
{
  "slug": "widget-review",
  "label": "Widget Review",
  "labels": [
    { "id": "lbl-regulatory", "name": "Regulatory", "color": "#DB0011" }
  ],
  "outcomeOptions": [
    { "id": "pass", "wording": "Pass", "severity": 0 },
    { "id": "refer", "wording": "Refer", "severity": 50 },
    { "id": "fail", "wording": "Fail", "severity": 100 }
  ],
  "defaultOutcomeId": "pass",
  "questions": [
    {
      "id": "q-wr-spec",
      "text": "Was the widget specification followed?",
      "questionGroup": "Build",
      "labelIds": ["lbl-regulatory"],
      "responseType": "yes-no-na",
      "optionOutcomes": { "No": "fail" },
      "remediationActions": [
        "Rework the widget to the agreed specification and re-submit."
      ],
      "deprecated": false
    },
    {
      "id": "q-wr-tested",
      "text": "Was the widget tested before dispatch?",
      "questionGroup": "Build",
      "responseType": "yes-no-na",
      "optionOutcomes": { "No": "refer" },
      "remediationActions": ["Run the standard test suite and record results."],
      "deprecated": false
    },
    {
      "id": "q-wr-test-evidence",
      "text": "Is the test evidence attached to the order?",
      "questionGroup": "Build",
      "responseType": "yes-no-na",
      "showWhen": { "q-wr-tested": { "equals": "Yes" } },
      "optionOutcomes": { "No": "refer" },
      "deprecated": false
    },
    {
      "id": "q-wr-channel",
      "text": "How was the order placed?",
      "questionGroup": "Order",
      "responseType": "single-choice",
      "options": ["Online", "Phone", "In branch"],
      "deprecated": false
    }
  ]
}
```

Field-by-field, the parts that carry behaviour:

- **`outcomeOptions` + `defaultOutcomeId`** — the Outcome vocabulary.
  `severity` orders the Outcomes (higher = worse) and drives the scoring: the
  Outcome is computed wholly from the responses, and the highest-severity
  Outcome any answered option maps to wins, starting from the default.
  `defaultOutcomeId` must name one of the `outcomeOptions` ids — the manifest
  validates this at load time and refuses the Case Type otherwise.
- **`questions[].id`** — stable, unique, never reused. Answers are stored
  keyed by this id in the Case row's `Answers` JSON blob, so an id is a
  forever-contract. Prefix with the type's initials (`q-wr-…`) to keep ids
  globally readable.
- **`responseType`** — one of `yes-no-na`, `single-choice`, `multi-choice`,
  `outcome`. Choice types must carry a non-empty `options` array.
- **`optionOutcomes`** — maps a response option to an Outcome id. Unmapped
  options contribute nothing (the default Outcome stands). The same mapping
  drives failure: every option mapped to a non-default Outcome marks the
  Answer as a failure, feeding the Issues list, its Issue Capture Fields and
  remediation. The universal N/A response is never a failure.
- **`showWhen`** — the applicability graph. A question with
  `"showWhen": { "q-wr-tested": { "equals": "Yes" } }` is only an Applicable
  Question when that answer holds. The graph must be acyclic —
  `detectCycles` in
  [src/evaluators/applicability-evaluator.js](../../src/evaluators/applicability-evaluator.js)
  is asserted in tests (Step 7).
- **`remediationActions`** — the Remediation Actions offered when that
  question fails.
- **`labels` / `labelIds`** — reporting metadata only; Labels never affect
  what the Reviewer sees.
- **`deprecated`** — Question Definitions are **never deleted** (hard rule);
  retire one by setting `deprecated: true` so old Cases keep resolving their
  answered ids.
- **`questionGroup`** — the named group the question renders under in the
  Questions tab, and the unit of per-group progress.

Keep the first bank small — three or four questions spanning two Question
Groups, one `showWhen`, one failure with a Remediation Action. That is enough
to exercise every downstream surface, and the Question Bank editor is the
right tool for growing it afterwards.

Then **publish it**:

```sh
node scripts/publish-bank.js widget-review
```

That writes `case-types/banks/widget-review.<hex>.txt`, an immutable copy named
by the bank's own identity. The bank itself is the current version — there is no
pointer file — so what publishing adds is the copy a Case completed against
today's bank will later resolve.

Re-run it after every bank edit. Skipping it does not break anything
immediately: a Case completed against an unpublished bank stamps a version, then
re-opens behind an "as-reviewed version unavailable" banner because no file
answers to it. A test fails on exactly that.

## Step 2 — Write the Case Type module

Create `case-types/widget-review.js`. It must default-export an object
satisfying the `CaseTypeConfig` typedef in
[src/sharepoint-client.js](../../src/sharepoint-client.js). Model it on
[case-types/complaints.js](../../case-types/complaints.js) — the only live
type and the reference implementation:

```js
// @ts-check
/** @typedef {import('../src/sharepoint-client.js').CaseTypeConfig} CaseTypeConfig */
/** @typedef {import('../src/sharepoint-client.js').Answer} Answer */

import { computeConfiguredOutcome } from '../src/evaluators/configured-outcome.js';
import { loadBank } from './load-bank.js';

const bank = await loadBank('./banks/widget-review.txt');

/**
 * The **Widget Review** Case Type. Its per-Case-Type groups derive from the
 * `Widget Review` display name — which lives on the registry entry (Step 3),
 * not here: `Reviewers - Widget Review`, `CaseTypeOwner - Widget Review`,
 * `JourneyOwner - Widget Review`.
 *
 * @type {CaseTypeConfig}
 */
const config = {
  listName: 'Cases-WidgetReview',
  detailFields: [
    { key: 'orderRef', label: 'Order reference' },
    { key: 'customerName', label: 'Customer name' },
    { key: 'orderDate', label: 'Order date' },
  ],
  sections: {
    details: { showInSummary: true },
    questions: { showInSummary: true },
    conversation: { allowMessagesWhen: ['Actions In Progress'] },
    notes: { showInSummary: false },
    issues: { showInSummary: true },
    remediation: { showInSummary: true },
    summary: {},
    appealRequest: {},
    appealReview: {},
    amendOutcome: {},
  },
  appeal: { raisedBy: 'responsiblePartyManager' },
  outcomeOptions: bank.outcomeOptions ?? [],
  labels: bank.labels,
  defaultOutcomeId: bank.defaultOutcomeId ?? '',
  questions: bank.questions,

  /** @param {Record<string, Answer>} answers */
  computeOutcome(answers) {
    return computeConfiguredOutcome(
      config.questions,
      answers,
      config.outcomeOptions,
      config.defaultOutcomeId
    );
  },
};

export default config;
```

What each field does, and how to choose its value:

- **No `displayName` here.** The human name is load-bearing — the three
  per-Case-Type group names derive from it, and dashboards and fetchers display
  it — so it is stated **once**, on the registry entry in Step 3 (#527). A
  config module that restated it would let the capability side and the
  Case-source eligibility side derive different group names.
- **`listName`** — the SharePoint list this type's Cases live in
  (`Cases-{PascalSlug}` by convention). Every Case Type declares one; there is
  no default list. Under `?mock=1` the fixture Cases are partitioned into a
  per-list mock store by this name
  ([src/services/create-sharepoint-client.js](../../src/services/create-sharepoint-client.js)),
  so a missing `listName` **throws at boot** as soon as a fixture Case carries
  your slug. The real list doesn't need to exist for any of the dev-loop work
  in this guide.
- **`eligibleGroups`** — extra group names that grant access to this type's
  Cases, **beyond** the three derived groups. Omit it unless you have a
  genuinely extra group. Do not restate a derived name such as
  `Reviewers - Widget Review`: it is already granted, and the restated copy does
  not move when the registry display name is renamed, so a decommissioned group
  would keep granting access (#527). A blanket group (e.g. plain `Reviewers`)
  would open the type to every reviewer — almost never what you want.
- **Allocation capacity** is app-wide, not Case Type configuration. Before
  claiming a Case, the framework totals this Reviewer's non-held
  `In-progress` Cases across every allocation source. At three Cases the
  Reviewer cannot claim another. `Actions In Progress` and every other status
  do not consume this capacity.
- **Review cadence** — four optional thresholds. Each has a framework default,
  and omitting a key means "use the default", never "no threshold".
  - **`actionCentreSlaDays`** — how long a Case may sit in each Action Centre
    reason group before its waiting chip reads as breached, e.g.
    `{ awaitingFrontline: 14 }`. Partial: name only the reasons you differ on.
    The reason ids are the ones in `ACTION_CENTRE_REASONS` — currently
    `overdue`, `awaitingFrontline`, `onHold`, `appeals` and `inProgress`;
    `npm run verify` rejects any other key. (`reopened` was removed by issue
    #691, and `reviewRequired` by issue #515 — neither had a transition that
    ever wrote its flag.)
  - **`breachWindowHours`** — how far ahead the dashboard's Owner "At risk" tile
    looks for a Case about to breach its due date. Positive integer; default 24.
    The tile's sub-reason label states the window it applied, so it stays honest.
  - **`reviewSlaWorkingDays`** — working days from the **allocation claim** to
    the Case's review Due Date, the date **overdue** is judged against.
    Positive integer; default 5. **Changing it moves no date already written.**
    The due date is computed once when the Reviewer claims the Case and stored
    on the Case row, so Cases already in someone's worklist keep the date they
    were given and only later claims see the new number. A Case that was never
    claimed through the app carries no review due date and can never read as
    overdue. The date is stored date-only, so a Case reads as overdue from
    midnight _on_ its due date — an SLA of 5 is four full working days plus an
    overdue fifth, the same semantics `remediationDueDate` already has.
  - **`remediationSlaWorkingDays`** — working days from **Send Actions** to the
    Remediation Due Date. Positive integer; default 10. **Changing it moves no
    date already written.** The due date is computed once at Send Actions and
    stored on the Case row, so in-flight Cases keep the date they were given and
    only later transitions see the new number. Expect this to be reported as a
    bug; it is the design.
- **Failure attribution** is not a flag: declare a `person` Issue Capture Field
  in `captureGroups` and tag it `role: 'attributedParty'`, so cross-Case-Type
  reporting can find it whatever your field key is.
- **`detailFields`** — the read-only Case Details panel, `{ key, label }`
  pairs. Values live in each Case row's `details` JSON blob keyed by `key` —
  adding a field here means your fixture Cases (Step 6) should carry that key.
- **`sections`** — membership is the allow-list: a Section absent from this
  object does not exist for this type. `showInSummary` opts a Section's block
  into the read-only Summary tab; `allowMessagesWhen` gates when Conversation
  messages may be posted during a live review — a terminal Case (`Completed` or
  `Void`) closes the thread for everyone regardless of the gate. The set above
  is the current standard full set — start from it and remove what the type
  genuinely doesn't need.

  An explicit `sections` object must retain `summary`, even when no other
  Summary block is configured. Omitting `sections` is still valid and keeps the
  default Section configuration. The **Send Actions** / **Complete Case**
  control is placed on Summary, while the two-step **Void Case** control is
  placed on Case Details; `showInSummary` does not move either action.

  `showInSummary` also takes a **list of roles** instead of a boolean, naming who
  the block is composed for rather than switching it on for everyone:

  ```js
  issues: { showInSummary: ['assignedReviewer', 'reviewerManager', 'controls'] },
  ```

  Any one of the viewer's roles matching is enough. The list can only **narrow**:
  the Section's access mode is resolved first, so naming a role never shows it a
  Section it is otherwise denied — this composes the Summary, it does not grant
  access. The valid names are the `ROLES` list in
  `src/services/section-access.js`; `npm run verify` rejects anything else.
  Reach for it only when a block genuinely reads differently for different
  audiences — the boolean form stays the default.

- **`appeal`** — who may raise an Appeal (`journeyOwner` for
  Complaints-style journeys, otherwise `responsiblePartyManager`) and who
  resolves it (always `controls` today, kept explicit).
- **`outcomeOptions` / `defaultOutcomeId` / `questions` / `labels`** — pulled
  from the bank, not duplicated. The `?? []` / `?? ''` coercions are
  deliberate: an absent bank field becomes an _invalid_ config that the
  manifest's load-time validation rejects loudly, not a silent fallback.
- **`computeOutcome`** — the one piece of real code. For a response-driven
  vocabulary, delegate to `computeConfiguredOutcome` as above. It is a plain
  exported function precisely so a future type can implement bespoke logic —
  applicability is data (`showWhen`), outcome is code.

Optional fields to know about (all in the `CaseTypeConfig` typedef):
`sectionLabels` renames a Section's display copy per type. Each Section carries
two spellings — a `tab` caption and a panel `heading` — so an override is either
a bare string, renaming both (`{ questions: 'Assessment' }`), or an object
naming either axis (`{ questions: { tab: 'Assess', heading: 'Assessment' } }`,
or `{ details: { heading: 'About this Case' } }`). Omitted keys and omitted axes
keep `DEFAULT_SECTION_LABELS`; `allowBulkOutcome: true` opts every Question
Group into the bulk-outcome control, and `questionGroups` overrides that per
group in either direction (`{ Build: { allowBulkOutcome: false } }`), so a type
states the rule once and names only the exceptions; `captureGroups` extends
per-failure capture; `remediationStatuses` narrows which Remediation
Resolutions a Reviewer is offered (`['complete', 'cancelled']`), see
[ADR-0037](../adr/0037-question-level-remediation-resolution.md);
`extraAmendmentReasons` **adds** to the shared Amendment Reasons offered on the
Amend Outcome Section (`[{ key: 'data-correction', label: 'Data correction' }]`).
The shared three are always offered, so declare only the additions — and note the
direction, which is why the key is not spelled like `voidReasons`: that one
narrows a closed vocabulary, this one extends an open one. A key colliding with a
shared one is ignored rather than re-labelling it. Case table
columns are not among them: every Case Type is listed under the same
framework-owned columns (see
[ADR-0040](../adr/0040-case-tables-are-framework-owned.md)).

## Step 3 — Register the slug in the manifest

Edit [case-types/manifest.js](../../case-types/manifest.js) and add **one entry**
to `CASE_TYPES` — the single Case Type registry (issue #508):

```js
// case-types/manifest.js — `CASE_TYPES` is exported from this array.
const registry = [
  {
    slug: 'complaints',
    displayName: 'Complaints',
    importer: () => import('./complaints.js'),
    bank: () => loadQuestionBank('./banks/complaints.txt'),
  },
  {
    slug: 'widget-review',
    displayName: 'Widget Review',
    importer: () => import('./widget-review.js'),
    bank: () => loadQuestionBank('./banks/widget-review.txt'),
  },
];
```

`CASE_TYPE_IMPORTERS`, `QUESTION_BANK_IMPORTERS`, and `permissions.caseTypes`
are all **derived** from this table, so there is nothing else to register.
`displayName` is stated here and **only** here (#527): both the capability side
(`permissions.caseTypes`) and the Case-source eligibility side
(`resolveAppCaseSources`, via `displayNameFor`) read this one copy.
`bank` is optional: omit it and the type simply does not appear in the Question
Bank editor until its artifact exists.

This is the entire integration surface with the rest of the app:

- `loadCaseTypeConfig('widget-review')` now resolves — and **validates** the
  outcome configuration on the way through (`validateConfiguredOutcomeConfig`
  checks every `optionOutcomes` target and `defaultOutcomeId` against
  `outcomeOptions`, throwing `InvalidCaseTypeConfigError` on any dangling id).
- `resolveAppCaseSources` ([src/setup/resolve-eligible-case-types.js](../../src/setup/resolve-eligible-case-types.js))
  considers **every** slug in `CASE_TYPE_IMPORTERS` when working out which
  Case sources the current user may see. There is no separate allow-list.
- The Question Bank editor page lists every bank in
  `QUESTION_BANK_IMPORTERS`, so your bank appears in the editor with no
  further wiring.

## Step 4 — User groups: derived from the registry entry

**No edit needed here.** `permissions.caseTypes` in
[src/services/permissions.js](../../src/services/permissions.js) projects
`CASE_TYPES`, so the entry you added in Step 3 already carries the display name:

```js
caseTypes: CASE_TYPES.map(({ slug, displayName }) => ({ slug, displayName })),
```

The registry entry's `displayName` is the only copy, and the group names derive
from it via `caseTypeGroupNames()`:

| Derived group                   | Grants                                                        |
| ------------------------------- | ------------------------------------------------------------- |
| `Reviewers - Widget Review`     | List access as a Reviewer of this type                        |
| `CaseTypeOwner - Widget Review` | Case Type Owner capability for this type (owner dashboards)   |
| `JourneyOwner - Widget Review`  | Journey Owner capability (journey cases page, raises appeals) |

Groups sit on two orthogonal axes: **functional capability** (what you can do
anywhere — `Controls`, `Reviewer Managers`, `Frontline`,
`ResponsibleParty-Managers`, `CORA Owner Delegates`) and **per-Case-Type list
access** (which type's Cases you can open — the three derived groups above, plus
`Frontline - Widget Review`, which no frontend code reads: it is the frontline
side's SharePoint ACL on the list, so it is not in `caseTypeGroupNames()` and
you do not declare it anywhere in code). Two rules worth internalising:

- The five functional roles above span **every** Case source automatically —
  a Controls user sees your new type with no extra group.
- The bare `Reviewers` functional group does **not** grant per-type list
  access. A reviewer sees your type only through `Reviewers - Widget Review`
  (or a group you listed in `eligibleGroups`). This is why the default
  `?asUser=reviewer` persona will _not_ see your Cases — Step 5 fixes that.

All of this is UX-only shaping; in production the real security boundary is
SharePoint list ACLs (out of scope here, covered by the provisioning docs).

## Step 5 — Add dev personas

Edit [dev/fixtures/personas.js](../../dev/fixtures/personas.js) and add mock
users holding the new groups, one per role you want to exercise:

```js
'reviewer-widget-review': {
  userId: 'user-reviewer-widget-review',
  displayName: 'Alex Reviewer Widget Review',
  groups: ['Reviewers - Widget Review'],
},
'case-type-owner-widget-review': {
  userId: 'user-case-type-owner-widget-review',
  displayName: 'Cam Case Type Owner Widget Review',
  groups: ['CaseTypeOwner - Widget Review'],
},
'journey-owner-widget-review': {
  userId: 'user-journey-owner-widget-review',
  displayName: 'Jules Journey Owner Widget Review',
  groups: ['JourneyOwner - Widget Review'],
},
```

Personas are selected with `?asUser=<key>`; the persona's `groups` array is
what `resolveCapabilities` and `resolveAppCaseSources` run against, and its
`userId` is what `assignedReviewer` on fixture Cases must match for "my
cases" surfaces. Update the file's header comment listing the available keys.
The existing cross-type personas (`controls`, `reviewer-manager`,
`responsible-party`) need no changes — their functional groups already span
your new type.

## Step 6 — Seed example Cases

Edit [dev/fixtures/cases.js](../../dev/fixtures/cases.js). Each entry is a
`CaseRow` (typedef in `src/sharepoint-client.js`); under `?mock=1` the flat
array is partitioned into per-list stores by each type's `listName`, so these
rows become the contents of your mock `Cases-WidgetReview` list.

Seed at least three, chosen to light up different surfaces:

```js
// --- widget-review fixture cases (Widget Review) ---
{
  // Outstanding: In-progress and assigned, so it appears on the reviewer
  // dashboard's Outstanding Cases and is resumable from My Cases.
  id: 'widget-review-case-1',
  caseType: 'widget-review',
  title: 'Widget order #1',
  status: 'In-progress',
  assignedReviewer: 'user-reviewer-widget-review',
  responsibleParty: 'user-agent-a',
  answers: {
    'q-wr-spec': { value: 'Yes' },
  },
  conversation: [],
  details: {
    orderRef: 'WR-2026-0001',
    customerName: 'Taylor Morgan',
    orderDate: '2026-07-01',
  },
  notes: '',
  completedAt: null,
  dueDate: _nextWeek.toISOString(),
  created: '2026-07-01T08:00:00Z',
  etag: 'etag-wr1-v1',
},
{
  // Unassigned: In-progress with assignedReviewer '' — this is what the
  // Allocation "Request next Case" button draws from.
  id: 'widget-review-case-2',
  caseType: 'widget-review',
  title: 'Widget order #2',
  status: 'In-progress',
  assignedReviewer: '',
  responsibleParty: 'user-agent-b',
  answers: {},
  conversation: [],
  details: {
    orderRef: 'WR-2026-0002',
    customerName: 'Morgan Taylor',
    orderDate: '2026-07-02',
  },
  notes: '',
  completedAt: null,
  dueDate: _nextWeek.toISOString(),
  created: '2026-07-02T08:00:00Z',
  etag: 'etag-wr2-v1',
},
{
  // Completed with one failure → outcomeAtCompletion 'refer'. Exercises the
  // Issues list, Remediation, the frozen Outcome, Amend Outcome, and appeals.
  id: 'widget-review-case-3',
  caseType: 'widget-review',
  title: 'Widget order #3',
  status: 'Completed',
  assignedReviewer: 'user-reviewer-widget-review',
  responsibleParty: 'user-agent-a',
  answers: {
    'q-wr-spec': { value: 'Yes' },
    'q-wr-tested': {
      value: 'No',
      justification: 'Dispatched without a recorded test run.',
    },
    'q-wr-channel': { value: 'Online' },
  },
  conversation: [],
  details: {
    orderRef: 'WR-2026-0003',
    customerName: 'Priya Nair',
    orderDate: '2026-06-20',
  },
  notes: '',
  completedAt: _threeDaysAgo.toISOString(),
  outcomeAtCompletion: 'refer',
  created: '2026-06-20T08:00:00Z',
  etag: 'etag-wr3-v1',
},
```

Rules the fixtures must obey:

- **`answers` keys are question ids from your bank**, and each `value` must
  be a legal response for that question's `responseType`/`options`. A failed
  Answer conventionally carries a `justification`.
- **The completed Case must be self-consistent**: running your module's
  `computeOutcome(answers)` over its answers must produce its
  `outcomeAtCompletion`. Step 7's tests pin this, so an outcome-rule change
  that silently invalidates a fixture fails loudly.
- **`details` keys match `detailFields[].key`** from Step 2.
- **A `To-allocate` Case (`status: 'To-allocate'`, `assignedReviewer: ''`) is
  what makes allocation demonstrable** — `cora-allocation` draws the oldest
  `To-allocate` Case across the user's eligible sources. The status is the whole
  predicate, so an unassigned `In-progress` fixture is never offered however
  empty its Reviewer field. "Oldest" is by `relatedDate`, the Case Type–specific
  reference date, falling back to `created` on a Case that carries no related
  date — so a Case Type that never populates `RelatedDate` still allocates
  oldest-created-first, and a fixture that wants to pin the draw order should
  set `relatedDate`.
- **`assignedReviewer` must match a persona `userId`** for assigned-to-me
  surfaces to light up for that persona.
- `etag` is any unique string (the mock client uses it for optimistic
  concurrency); `dueDate`/`created`/`completedAt` use the `_nextWeek` /
  `_threeDaysAgo` style clock constants already defined at the top of the
  file, so fixtures stay fresh relative to "today".

Also extend the inventory doc-comment at the top of `cases.js` — it is the
map future maintainers read first.

If you want the type demonstrable further through the lifecycle, clone what
the complaints fixtures do: a Completed Case with an open appeal (an `appeals`
entry) for the Controls resolution flow, or an `Actions In Progress` Case for
the remediation-tracking loop. Start with the three above; add more when a
surface you care about has nothing to show.

## Step 7 — Write the contract tests

Create `tests/widget-review.test.js` (flat `tests/` directory, filename =
subject). Mirror [tests/complaints.test.js](../../tests/complaints.test.js) —
keep code-owned configuration and dynamic fixture/integration contracts here.
The generic configuration gate already checks non-empty choice and Outcome
options, `showWhen` references and values, and cycles for every registered Case
Type. Do not restate those checks or pin a question count, catalogue inventory,
list name, response wording, or authored Outcome example in this suite.

```js
// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import config from '../case-types/widget-review.js';
import { cases } from '../dev/fixtures/cases.js';

test('widget-review: Case Details fields expose stable keys and labels', () => {
  for (const field of config.detailFields ?? []) {
    assert.ok(field.key, 'field key');
    assert.ok(field.label, `${field.key} label`);
  }
});

test('widget-review fixtures: an outstanding, an unassigned, and a completed Case exist', () => {
  const fixtures = cases.filter((c) => c.caseType === 'widget-review');
  assert.ok(
    fixtures.some(
      (c) => c.status === 'In-progress' && c.assignedReviewer !== ''
    )
  );
  assert.ok(
    fixtures.some(
      (c) => c.status === 'In-progress' && c.assignedReviewer === ''
    )
  );
  assert.ok(fixtures.some((c) => c.status === 'Completed'));
});

test('widget-review fixtures: the Completed Case answers compute to its frozen outcomeAtCompletion', () => {
  const completed = cases.find(
    (c) => c.caseType === 'widget-review' && c.status === 'Completed'
  );
  assert.ok(completed);
  assert.equal(
    config.computeOutcome(completed.answers).outcome,
    completed.outcomeAtCompletion
  );
});
```

Add only invariants distinctive to code-owned configuration or the way fixtures
exercise the application. Express them over the configured data rather than
naming particular Questions, Groups, Outcomes or wordings.

**You must also update the pinned known-slug tests.** Three existing tests in
[tests/case-type-manifest.test.js](../../tests/case-type-manifest.test.js)
deliberately pin the manifest's slug list (`['complaints']`) — the
known-slugs assertion, the `UnknownCaseTypeError` message assertion, and the
`CaseLoader` unknown-slug error-state assertion. Adding your slug to
the manifest fails all three until you extend the expected list. This is by
design: the live Case Type set is a reviewed contract, not an incidental
side effect of the registry.

Then run the whole gate:

```sh
npm run check        # tsc --checkJs over the JSDoc types
node --test          # the full suite
npm run test:coverage  # 95% global floor over src/ and case-types/
```

The suite is also your safety net for the earlier steps:
[tests/case-type-eligibility-consistency.test.js](../../tests/case-type-eligibility-consistency.test.js)
fails if a manifest slug is missing from `permissions.caseTypes` (Step 4), if a
config module restates `displayName` (Step 2), or if the module declares no
`listName` (Step 2) — so a forgotten wiring step surfaces as a named test
failure, not as a silently empty dashboard.

Your module counts toward the coverage floor the moment it exists under
`case-types/`; the dynamic completed-fixture contract above exercises its
Outcome calculation without pinning an authored response example.

## Step 8 — Run the dev harness and tour every surface

```sh
npx serve .
```

Then walk the type through each surface, switching personas via the URL. A
hard reload (Cmd+Shift+R) between visits avoids Edge/Chrome serving stale
modules from cache.

| Surface              | URL                                                          | What to verify                                                                                                      |
| -------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Reviewer dashboard   | `/dev/?mock=1&asUser=reviewer-widget-review#/dashboard`      | KPI strip and Outstanding Cases show Widget Review Cases; Action Centre groups them by reason                       |
| Allocation           | same page                                                    | "Request next Case" draws `widget-review-case-2` (the unassigned one) and assigns it to you                         |
| Case Review          | click a Case, or `#/case/widget-review/widget-review-case-1` | Details fields, Question Groups, `showWhen` behaviour, Issues on failure, Outcome updating as you answer, auto-save |
| Completion & Summary | answer everything on an In-progress Case                     | Case completes; Summary tab shows the blocks your `sections` opted in via `showInSummary`                           |
| Remediation          | the Completed Case with a failure                            | Remediation Actions from the failed question appear; Conversation opens in `Actions In Progress`                    |
| Question Bank editor | `/dev/?mock=1#/question-bank`                                | The Widget Review bank is listed and editable; the impact simulation runs against your fixtures                     |
| Owner view           | `?asUser=case-type-owner-widget-review`                      | The Case Type Owner surfaces scope to Widget Review                                                                 |
| Journey cases        | `?asUser=journey-owner-widget-review` → `#/journey-cases`    | The Journey Owner sees the type's Cases (and can raise appeals if `appeal.raisedBy` is `journeyOwner`)              |
| Controls             | `?asUser=controls` → the Completed Case                      | Amend Outcome is available; Appeal Review appears only once that Case carries an Appeal                             |
| Team reports         | `?asUser=reviewer-manager` → `#/my-team`, `#/team-stats`     | The functional-role personas see the new type without any new group                                                 |
| Isolation check      | `?asUser=reviewer` (plain `Reviewers` group)                 | The new type's Cases are **not** visible — per-type access is doing its job                                         |

When the tour passes, the code-side onboarding is done.

## Troubleshooting

- **`UnknownCaseTypeError: Unsupported Case Type slug`** — the slug isn't in
  `CASE_TYPE_IMPORTERS` (Step 3), or a fixture/persona spells it differently.
- **`InvalidCaseTypeConfigError` at load** — an `optionOutcomes` value or
  `defaultOutcomeId` names an Outcome id that isn't in `outcomeOptions`. The
  manifest validates on load, deliberately before the type is ever usable.
- **`partitionCasesByList: Case Type "…" declares no listName`** at boot
  under `?mock=1` — you added fixture Cases before giving the module a
  `listName` (Step 2). There is no default store; the throw is intentional.
- **Bank fails to load / JSON parse error** — the artifact must be valid JSON
  despite the `.txt` extension; a trailing comma is the usual culprit. Check
  the browser console for the `load-bank` fetch.
- **Dashboard empty for your reviewer persona** — the persona's group must be
  exactly `Reviewers - <displayName>` with the display name from the registry
  entry (Step 3) — the single copy. Remember bare `Reviewers` grants nothing
  per-type.
- **Allocation says "No Cases available"** — no fixture Case for your slug is
  simultaneously `In-progress` **and** `assignedReviewer: ''`.
- **A fixture Case won't open / behaves oddly** — its `answers` reference ids
  or option values that don't exist in your bank, or the Completed Case's
  `outcomeAtCompletion` disagrees with `computeOutcome` (the Step 7 test
  catches this).
- **Changes not showing in the browser** — hard reload; the module cache
  happily serves the previous version of a lazily-imported Case Type module.

## What this deliberately did not cover

Everything above runs against `MockSharePointClient`. Taking the type to a
live environment adds the SharePoint-side provisioning, which has its own
runbooks and one genuinely irreversible step (indexing columns on the
still-empty list):

- [docs/case-type-onboarding.md](../case-type-onboarding.md) — the
  `Cases-{slug}` column schema, indexed columns, and provisioning checklist.
- [Provisioning runbook](provisioning-runbook.md) — groups, ACLs, and the
  holiday-list burden.
- `scripts/deploy_to_sharepoint.py` — deploying the source tree (prod and
  UAT, ADR-0033).

And if after reading this you'd rather not hand-type the boilerplate:
`python3 scripts/scaffold_case_type.py --slug widget-review --display "Widget Review"`
performs most of Steps 1–7 with starter content (ADR-0028) — you now know
exactly what it's doing, and what to replace. It declares a `listName` for you,
defaulted from the slug as `Cases-{PascalSlug}`; pass `--list-name` if the list
was provisioned under another name (#525). Its closing message names the three
registry-contract tests in `tests/case-type-manifest.test.js` that a new slug is
supposed to move — widen those by hand, and treat any other red test as real.
