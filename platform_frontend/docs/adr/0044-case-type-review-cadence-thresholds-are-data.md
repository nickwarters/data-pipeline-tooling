# ADR-0044: Review-cadence thresholds are per-Case-Type data with framework defaults

- Status: Accepted
- Date: 2026-08-01
- Applies: [ADR-0035](./0035-case-type-descriptors-express-variation-behaviour-stays-in-code.md)
- Extends: [ADR-0025](./0025-working-day-sla-due-dates.md)
- Leaves unchanged: [ADR-0030](./0030-action-centre-reason-flags-in-code-not-calculated-columns.md)

## Context

Every number that decides how fast a Case Type is expected to move was a
hardcoded module constant:

- The Action Centre's five per-reason breach cadences (0 / 7 / 14 / 5 / 3 days)
  sat on the reason table in `services/action-centre-model.js`.
- The dashboard Owner lane's "about to breach" look-ahead was a literal 24 hours
  in `evaluators/kpi-strip-model.js`, baked into a predicate named
  `isBreachingWithin24h` and into the user-facing copy `Breaching < 24h`.
- The remediation SLA was `REMEDIATION_SLA_WORKING_DAYS = 10` in
  `config/working-days.js`.

Complaints is the only live Case Type, so these read as platform constants. They
are not. They are Complaints' operating cadence, and a second Case Type would
inherit it silently — no error, no warning, just the wrong urgency on someone
else's worklist. A Case Type whose remediation genuinely takes twenty working
days would have had its rows badged as breaching on day eleven, and nothing in
the codebase would have said why.

There was also a fourth number that looked like it belonged in this set and did
not. `CaseTypeConfig.slaHours` was declared, documented as driving "the
working-day due-date and the overdue evaluator", and read by nothing.
`isOverdue()` took a `_caseTypeConfig` parameter it ignored, and every caller
passed `undefined` positionally to reach `now`.

## Decision

**Each review-cadence threshold is an optional `CaseTypeConfig` key whose
default lives next to the code that reads it.**

Three keys:

| Key                                            | Default                             | Read by                              |
| ---------------------------------------------- | ----------------------------------- | ------------------------------------ |
| `actionCentreSlaDays?: Record<string, number>` | the reason's own `defaultSlaDays`   | the dashboard Action Centre          |
| `breachWindowHours?: number`                   | `DEFAULT_BREACH_WINDOW_HOURS` (24)  | the KPI strip's Owner "At risk" tile |
| `remediationSlaWorkingDays?: number`           | `REMEDIATION_SLA_WORKING_DAYS` (10) | `CaseMachine` at Send Actions        |

An absent key means "use the framework default", never "no threshold".
Complaints declares none of the three, so its behaviour is unchanged in every
respect — the same numbers, the same copy, the same projected `CaseSource`
object, key for key.

### This is the data-only variation ADR-0035 already permits

ADR-0035 draws the line at "stable keys, labels, property paths, ordering,
membership, simple flags, and references to a closed code-owned vocabulary" on
the configuration side, and `if`/`switch` decisions, predicates and policy on
the code side. A number is the simplest thing on that list. A number keyed
against a closed code-owned vocabulary — the Action Centre reason ids — is the
"reference to a closed vocabulary" case, exactly as `sections` references the
Section registry and `showInSummary` references `ROLES`.

No predicate moves into configuration. `isOverdue`, `isBreachingSoon` and the
Send Actions transition all stay in code; what varies is the constant each one
compares against.

### Defaults live beside their reader, not in a central registry

An earlier draft proposed a `src/config/thresholds.js` holding all three. It was
rejected. A central registry would put each number one indirection away from the
only code that reads it, and — for the Action Centre — would create a second
structure keyed by reason id that has to be kept in step with the reason table
by hand.

So: `defaultSlaDays` is a field **on the reason object**, because the reason
table already _is_ the reason vocabulary; `DEFAULT_BREACH_WINDOW_HOURS` sits
beside `isBreachingSoon`, its only reader; and `REMEDIATION_SLA_WORKING_DAYS`
stays exactly where ADR-0025 put it, in `config/working-days.js`. Moving that
last one would have touched four files and changed no behaviour.

### The reason table stays code

ADR-0030 is untouched. Configuration selects a number against an existing reason
id; it cannot add, rename or remove a reason, and it cannot change a reason's
filter, clock field, role or copy. An `actionCentreSlaDays` key naming no reason
is a typo, and a typo here would otherwise be **silent** — the entry is simply
never looked up, so the Case Type keeps the framework cadence while its
configuration claims otherwise. `scripts/verify-config.js` therefore rejects an
unknown key by name, in the same register as the existing `sections` key check,
and also rejects the numbers a type cannot: a negative day count, a zero-length
breach window, a fractional working day. Zero is allowed for a cadence, because
Overdue is legitimately breached the moment it lands.

### The two dashboard thresholds are projected onto `CaseSource`, not carried

The Action Centre and the KPI strip only ever hold `CaseSource`. So
`resolveCaseSourcesFromCaseTypes()` copies `actionCentreSlaDays` and
`breachWindowHours` onto the source, omitting each when the Case Type declares
nothing — the same omit-when-undefined shape `maxInProgressCases` already uses.
`CaseSource` is not widened to carry the whole `CaseTypeConfig`.

**This deserves an honest reading rather than a precedent citation.**
`CaseSource` began as a data-access descriptor: which list, under what slug, by
what name. `maxInProgressCases` was already a policy value on it, and these two
push it further in that direction — it is becoming a Case-Type policy
descriptor with a data-access core. That is the decision taken here, taken
deliberately, and the alternatives were both worse: putting the config object on
the source would give every dashboard reader every descriptor there is, and
loading the Case Type module on the dashboard is the coupling ADR-0040 removed
from Team Cases.

The constraint that keeps this from becoming a dumping ground: **a value is
projected onto `CaseSource` only when a surface that holds nothing but a
`CaseSource` needs it.** `remediationSlaWorkingDays` is not projected, precisely
because the Case Review page reads the Case Type config directly and has no need
of it. If a third or fourth knob wants a seat on `CaseSource`, that is the
signal to give the dashboard a proper policy lookup instead of another key.

### `CaseRow.caseType` holding the registry slug is load-bearing

The Action Centre looks a row's cadence up by `row.caseType`, keyed against
`CaseSource.slug`. That agreement holds today —
`HttpSharePointClient` maps the list's Case Type column to the registry slug,
and the mock fixtures use slugs — but it is an agreement between two modules
that never name each other. If it ever broke, the failure would be silent: an
unmatched key resolves to the framework default, which is a plausible-looking
number rather than an error. The lookup carries a comment saying so.

### `slaHours` is deleted, not wired

Overdue is defined **solely** by the persisted `CaseRow.dueDate`. Wiring a
per-Case-Type review SLA would mean writing that due date _from_ it at Case
creation, and this frontend does not create Cases — the row arrives with its due
date already set. A key that could only ever be a second, disagreeing opinion
about a date somebody else wrote is worse than no key.

So `slaHours` is removed from the typedef, from Complaints, from the scaffold,
from the fixtures and from the two documents that listed it. `isOverdue()` loses
its ignored config parameter and becomes `isOverdue(caseRow, now)`, which
removes the six call sites that were passing `undefined` positionally to reach
the second argument.

## Considered alternatives

- **A central `src/config/thresholds.js`.** Rejected, as above: an indirection
  away from every reader, and a second reason-keyed structure to keep in step.
- **Widen `CaseSource` to carry the whole `CaseTypeConfig`.** Rejected. Every
  dashboard reader would gain access to every descriptor, and the narrow
  descriptor that made the dashboard cheap would stop being narrow.
- **Load the Case Type module on the dashboard.** Rejected — this is the
  coupling ADR-0040 removed from Team Cases, for a handful of numbers.
- **Keep the thresholds as constants until a second Case Type exists.**
  Rejected. The failure mode is silent inheritance, so the cost is paid by
  whoever onboards that Case Type and does not think to look, which is precisely
  the person least placed to notice.
- **Wire `slaHours` to compute a due date on read.** Rejected. Two sources of
  truth for one date, one of them recomputed and one persisted, and they would
  disagree the first time either moved.

## Consequences

- Complaints is unchanged: it declares no threshold, so every default applies
  exactly as the constant did.
- A new Case Type inherits every default and says nothing. The scaffold does not
  emit these keys — inheriting the defaults is the point, and a scaffolded key
  is a number someone has to have an opinion about on day one.
- **Changing `remediationSlaWorkingDays` does not move due dates already set.**
  ADR-0025 computes `remediationDueDate` once at Send Actions and stores it on
  the row, never recomputing on read. So a change affects only later
  transitions; Cases already in remediation keep the date they were given. This
  is correct, and it is also exactly what an operator will report as a bug —
  "I changed the SLA and nothing moved". It is called out in the onboarding
  guide's bullet for the key for that reason.
- The Owner "At risk" sub-reason label now states the window it applied
  (`Breaching < 48h` for a Case Type declaring 48). It reads the window off the
  single Case Type present in the matched Cases, which is safe by construction:
  the sub-reason breakdown only renders when those Cases span at most one Case
  Type — more than one and the tile splits by Case Type instead.
- `isOverdue()` is a two-argument function. Any out-of-tree caller passing a
  config positionally would now be passing it as `now`; there are none in this
  repository, and `tsc` catches it.
- The holiday calendar stays global. Per-region holidays remain ADR-0025's open
  follow-up and are not addressed here: a Case Type can now choose _how many_
  working days it gets, not _which_ days are working days.

## Amendment — issue #571, 2026-08-14

The Action Centre gained an On Hold reason (ADR-0030 as amended), and with it
`actionCentreSlaDays.onHold` became a valid key — automatically, because the
config check validates keys against the reason table rather than a second
list. Its framework default is 14 days, a deliberately conservative
placeholder pending a product answer on what "parked too long" means. Zero is
the one value to avoid: it would badge every parked Case as breached the
moment it is parked, which defeats a group whose point is _not otherwise
urgent_.
