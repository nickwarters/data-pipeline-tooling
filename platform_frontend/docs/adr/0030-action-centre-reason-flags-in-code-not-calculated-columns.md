# 30. Action Centre reason flags live in code, stored as plain columns — no SharePoint calculated fields

Date: 2026-07-05

## Status

Accepted (supports [ADR-0007]; relates to [ADR-0008], [ADR-0009]; refines the reason
model introduced for the dashboard **Action Centre**, issue #287)

**One of the four reasons is currently unreachable.** The `appeals` reason — the
Controls "Appeals to work" group, keyed on the `hasOpenAppeal` flag — qualifies
for no capability in the shipped build, because the Appeals journey is switched
off behind the hard-coded `APPEALS_ENABLED` constant. Its row, clock, cadence
and flag pairing are unchanged and resume when the switch is deleted; the
consequence today is that a Controls-only user has no Action Centre groups at
all, so the panel is not composed for them. The other three reasons are
unaffected. See [the feature switches guide](../guide/feature-switches.md).

### Amendment — issue #691, 2026-08-03

**The decision stands; one sentence of its Context did not.** The Decision below says the
four state flags "only change on an explicit lifecycle transition the app already
performs (send to Frontline, raise/close an Appeal, reopen, submit for review)". That was
false when it was written. Only one of those four transitions existed — raise/close an
Appeal. There was no send-to-Frontline step, no reopen, and no submit-for-review, and
nothing anywhere in `src/` ever wrote any of the four columns. The ADR's own "Negative"
consequence — _the app must not miss a transition_ — had therefore been realised in full
from day one, silently: every reason group but Overdue was permanently empty in
production, because Overdue is the one reason computed on read.

The written half is now real, and the missing halves are named rather than assumed.

**Where the rule lives.** `src/services/action-centre-flags.js` is the single expression
of the flag/clock pairing, and the transitions that change these states call it and
spread the whole pair into the field bag they were already building. It is deliberately
_not_ an interception inside the clients' `patchCase` (where the assignment stamp sits):
`conversation` and `appeals` each have exactly one writer, both of which already hold
everything the derivation needs, and routing through the clients would have meant
persisting a per-message schema field for ever purely to carry the writer's own knowledge
to a later interception point. The property that moves with it is worth stating plainly:
nothing prevents a _new_ writer from setting one of these columns without its clock. The
module says so, and it is the one place to change if that stops being enough.

- **`AwaitingResponsibleParty` / `AwaitingSince`.** `postConversationMessage` writes the
  pair in the same PATCH as the message that moved it: a Reviewer posting sets the flag,
  a Responsible Party or their Manager replying clears it, anyone else changes neither
  half. The side comes from the roles Section access already resolved for the page, not
  from `Message.author` — that is a display name, while a Case stores its people by
  account.
- **The rule is knowingly coarser than the state it stands for.** It reads _"the newest
  message came from a Reviewer"_, not _"the Reviewer asked something and no reply has come
  back"_. A Reviewer posting "thanks, closing" re-arms the flag. The alternative is asking
  a Reviewer to classify their own message, which buys precision with friction on every
  post; an occasional over-count that any reply — or completing the Case — clears is the
  better trade. Accepted, not overlooked.
- **The flag has an exit.** `CaseMachine`'s `transitionToCompleted`,
  `transitionToFinalComplete` and `transitionToVoid` clear the pair. A closed Case waits
  on nobody, and without that clearing a Case whose frontline replied by phone would age
  in its Reviewer's group indefinitely, because the reason filter carries no status
  predicate.
- **`HasOpenAppeal` / `AppealRaisedAt`.** `raiseAppeal` and `resolveAppeal` put the pair
  in the field bag beside the `appeals` blob it is derived from. Both resolution branches
  now write one atomic multi-field PATCH — the agreed branch already had to, so the
  corrected-reporting columns land with the Appeal, and the rejected branch joins it so
  the flag cannot land apart from the history that justifies it.
- **Neither clock is a fresh clock reading.** The Awaiting clock is the posted message's
  own timestamp, the Appeal clock the Appeal's own recorded `at`. `SaveQueue` replays the
  identical field bag after a 412, so a clock read at write time would re-mint on every
  retry and silently reset an SLA age the Action Centre sorts and breaches on.
- **`Reopened` / `ReopenedAt` — read surface removed.** There is no reopen transition in
  this app and no fourth lifecycle status to reopen into; resolving an Appeal as agreed
  authors an Amended Outcome and leaves the Case Completed. The reason entry, the
  `CaseRow` fields, the `ListCasesFilter` key, both clients' filter branches and mappings,
  the tone styles and the fixtures are gone. The SharePoint columns are left in place —
  dropping a column is a manual, irreversible list-settings action, and an unread column
  costs nothing — but they are no longer provisioning requirements ([ADR-0031]'s index set
  drops from 14 to 13). Consequence tracked as issue #701: `reopened` was the only reason
  gated on `ownedCaseTypes`, so a Case Type Owner holding no other role now has no Action
  Centre reason at all. The dashboard panel is already gated on holding at least one
  reason, so such a viewer sees no panel rather than an empty one.
- **`ReviewRequired` — still unwritten.** No transition submits a Case for review, and
  there is no status for one, so the group is empty in production. It is left standing
  rather than removed because, unlike Reopened, the reason is wanted: issue #699 covers
  building the transition. The reason entry says so in its own words, and the mock fixture
  seeding it is labelled as the one flag with no transition behind it.

Separately, and found while removing Reopened: `HttpSharePointClient` read an `anyOf` with
no branches as _no condition at all_ — the whole list — where the mock read it as matching
nothing. An OR of no branches now emits a never-true condition, and the two clients are
asserted to agree on it.

Net: two of the four state flags are written by the app, one reason is retired, and one is
honestly labelled as pending. Nothing about the "no calculated columns, no scheduled job,
no Power Automate" decision changes.

### Amendment — issue #513, 2026-08-10

**The Awaiting Frontline pair now has two writers.** Alongside
`postConversationMessage`, `CaseMachine.transitionToActionsInProgress` — the **Send
Actions** transition — sets the pair via `awaitingFrontlineSent(reportableAt)`. It clocks
from `reportableAt`: the hand-off and the reportable milestone are one event, so reading
the clock twice would give that event two timestamps. This is the rule stated above for
every clock, applied to the new writer.

**"Send to Frontline" means the Send Actions transition** — the Case leaving `In-progress`
for `Actions In Progress` with its Remediation Actions handed to the Responsible Party —
not posting a Conversation Message to them, which is the pair's other writer. The
Decision below already named the term; the transition it names has existed since the
lifecycle was built, and only its flag write was missing.

**The clearing asymmetry is knowingly accepted.** After Send Actions the flag has exactly
three exits: a Conversation post from the Responsible Party or their Manager, completion,
or void. A Responsible Party who works the Remediation tab and never posts therefore
leaves the Case ageing in Awaiting Frontline, labelled "N days no reply", while the
Remediation tab shows active progress. We accept that here on the same grounds the amendment above accepts a coarser
rule for the Conversation writer: the precise alternative — treating remediation activity
as a reply — buys accuracy by teaching the flag a second vocabulary, and every path still
clears on completion. What cadence the group should use for a Case in this state is a
separate open question, not settled here.

## Context

The dashboard Action Centre groups a Reviewer/Controls/Owner worklist by
**reason** — `overdue`, `awaitingResponsibleParty` (Awaiting Frontline), `reviewRequired`,
`hasOpenAppeal`, `reopened`. Each reason is queried by an **indexed** `ListCasesFilter`
so a group-header count is a cheap `$count` and the paged rows are a cheap `$top`/`$skip`
([ADR-0007]) — the client never holds the backlog. That requires each reason to be
expressible against a queryable column.

The obvious way to populate those columns is a **SharePoint calculated column** (a
formula evaluated by SharePoint). We reject that. The only maintenance surface available
to this team is the SharePoint **web UI** — there is no SharePoint Designer, no PnP, no
scripted provisioning. A calculated column's formula would therefore live **only in the
SharePoint UI**: un-versioned, un-reviewable, un-testable, and impossible to roll back or
diff. A logic change would be an out-of-band edit in a text box, invisible to the repo.
That is exactly the coupling the framework avoids — the deployed JS is the source
([ADR-0005]), and every non-trivial rule should be version-controlled and unit-tested
(CLAUDE.md).

## Decision

**No calculated columns.** Every reason flag is either computed in versioned JS or stored
as a **plain (dumb) column the app itself writes.** The five reasons split into two kinds:

### 1. Time-derived facts — never stored, computed from a raw date column

`overdue`, the SLA-breach flag, and every "N days" age are pure functions of a raw date
column plus the current clock. They are **not** stored:

- **`overdue`** is a query-time comparison against the plain `DueDate` column:
  a case is overdue when it is still `In-progress` and `DueDate` is in the past. In OData
  the filter is `DueDate lt <now> and Status eq 'In-progress'`; the mock client's
  `_predicate` applies the same rule; and `rowFromItem` **derives** the display flag from
  `Status` + `DueDate` rather than reading any `Overdue` column.
- **breach / day counts** are computed at render time in `waitingInfo()` /
  `daysWaiting()` in `action-centre-model.js`.

A stored `overdue` would be **wrong**: a case goes overdue at midnight with no edit, so a
persisted value would go stale until the next save. Computing on read is both correct and
fully in-repo.

### 2. State booleans — plain `Yes/No` columns, written by the app on transition

`awaitingResponsibleParty`, `hasOpenAppeal`, `reopened`, and `reviewRequired` are genuine
**states** that only change on an explicit lifecycle transition the app already performs
(send to Frontline, raise/close an Appeal [ADR-0027], reopen, submit for review). For
these:

- SharePoint holds each as a **plain indexed `Yes/No` column** (`AwaitingResponsibleParty`,
  `HasOpenAppeal`, `Reopened`, `ReviewRequired`), each paired with a plain `DateTime`
  clock column (`AwaitingSince`, `AppealRaisedAt`, `ReopenedAt`) for the age.
- The **app is the sole writer.** The derivation rule lives in versioned JS and is
  PATCHed as an ordinary field-level write in the same `SaveQueue` transaction as the
  transition ([ADR-0007] field-level PATCH, [ADR-0008] auto-save). SharePoint stores a
  dumb value; it evaluates no formula.
- OData `$count` / `$filter` work exactly as before, because these are real indexed
  columns — just app-written, not calculated.

### Net shape

Zero calculated columns. Every rule is either JS-computed on read (time-derived) or
JS-computed on transition and persisted as a plain value (state). SharePoint provisioning
is reduced to _"add these plain `Yes/No` + `DateTime` columns and index them"_ — a
point-and-click list-settings task with **no formula to maintain out-of-band**. All
reason logic versions with the code and is unit-tested to 100% coverage.

## Considered options

- **SharePoint calculated columns** — rejected: the formula would live only in the SP UI,
  un-versioned and un-testable, and this team has no scripted way to provision or diff it.
  A logic change could never be committed.
- **Compute every flag client-side from raw Case data** — rejected: to filter/count a
  reason the client would have to fetch the whole backlog and evaluate in JS, defeating
  the cheap `$count`/paged-`listCases` design ([ADR-0007]) and not scaling.
- **A scheduled job (Power Automate / timer) that writes the flags** — rejected for the
  same reason as calculated columns: the logic would live outside the repo, in a
  flow-designer surface this team can't version or test. Time-derived facts don't need it
  (computed on read); state flags are already written inline by the app on transition.

## Consequences

**Positive**

- **All reason logic is in the repo** — versioned, code-reviewed, unit-tested, diffable,
  revertable. Changing a rule is a normal PR + deploy, never a hidden SP-UI edit.
- Mock and HTTP clients apply the _same_ rule (e.g. `overdue`), so mock-first dev
  ([ADR-0009]) stays faithful.
- SharePoint provisioning is trivial and formula-free.

**Negative**

- **The app must not miss a transition.** Because a state flag is only correct if the app
  writes it, any code path that performs a lifecycle transition must set the paired
  flag+clock. A missed write is a silent staleness bug — mitigated by routing all
  transitions through the same helpers and covering them with tests.
- Back-filling flags for Cases created before a flag existed needs a **one-off migration**
  (a scripted PATCH pass), since there is no formula to populate them retroactively.

[ADR-0005]: ./0005-jsdoc-with-tsc-typecheck.md
[ADR-0007]: ./0007-case-storage-shape.md
[ADR-0008]: ./0008-autosave-and-concurrency.md
[ADR-0009]: ./0009-mock-first-dev-loop.md
[ADR-0027]: ./0027-appeal-flow-journeyowner-controls.md
[ADR-0031]: ./0031-scaling-against-the-list-view-threshold.md
