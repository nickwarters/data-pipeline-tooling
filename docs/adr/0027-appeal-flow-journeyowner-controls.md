# 27. Appeal flow: per-Case-Type raiser, resolved by Controls

Date: 2026-07-01

## Status

Accepted (supersedes the QA-based **Appeal** in CONTEXT.md; amends [ADR-0011]; relates to
[ADR-0026])

## Context

CONTEXT.md's **Appeal** was raised by the Responsible Party (or their Manager) and
**resolved by the QA Reviewer**, who then authored corrective **Answer Overrides**. With
QA retired and Answer Override shelved ([ADR-0026]), the appeal flow is re-homed. Grill
decision **D5**: the appeal **raiser is configurable per Case Type** — for Complaints it
is the **Journey Owner**; for other types it defaults to the **Responsible Party
Manager** — and the resolver is **Controls**. Two tabs express the two ends: **Appeal
Request** (raise) and **Appeal Review** (resolve).

## Decision

### Per-Case-Type configuration ([ADR-0004])

The Case Type module declares:

```js
appeal: {
  raisedBy: 'journeyOwner' | 'responsiblePartyManager',
  resolvedBy: 'controls'   // always 'controls' today, kept explicit so gating is data-driven
}
```

`example-review` and `complaints` set `raisedBy: 'journeyOwner'`; other types default to
`'responsiblePartyManager'`.

### Storage (unchanged entity, [ADR-0007])

An Appeal remains an additive `appeals[]` JSON blob on the original Case row, lifecycle
`raised → underReview → resolved{ agreed | rejected }`, one open Appeal at a time, full
history retained. It carries the **appellant's rationale** (required on raise) and the
**resolver's rationale** (required on resolve). Only the *actors* change:

- **Raised** by whichever role `appeal.raisedBy` names, on a `Completed` Case only.
- **Resolved** by **Controls**.
- **Agreeing** no longer means authoring Answer Overrides. It means Controls accepts the
  outcome was wrong and then authors a case-level **Amended Outcome** ([ADR-0026]) — the
  Appeal id is recorded on the amendment's provenance. **Rejecting** records rationale
  and changes nothing.

### Two tabs, two Sections ([ADR-0011])

- **`appealRequest`** — where the appeal is raised/triaged. `edit` for the configured
  `raisedBy` role on a `Completed` Case; `read-only` for Controls, Assigned Reviewer,
  Case Type Owner, Journey Owner (when not the raiser); `hidden` otherwise. The cell is
  **function-valued**, reading `caseTypeConfig.appeal.raisedBy` to decide which role gets
  `edit`.
- **`appealReview`** — where Controls resolves. `edit` for **Controls** on a `Completed`
  Case with an open Appeal; `read-only` for the raiser, Assigned Reviewer, Case Type
  Owner, Journey Owner; `hidden` otherwise.

Both are `Completed`-only (there is nothing to appeal before the Case is closed).
Neither feeds the Summary.

### Journey Owner's cross-case reach

Separately from a single Case's access row, a **Journey Owner** sees the **Summary of
every Case of their case type(s)** ([ADR-0022] `ownedJourneyCaseTypes`). That is a
*list-scope* capability (a dashboard / cross-case query), not expressible in the per-Case
matrix alone; it is delivered as a Journey Owner view that lists cases of the type and
links into each Case's (read-only) Summary. The per-Case `summary` matrix cell grants
`journeyOwner: read-only` so those links resolve.

## Considered options

- **Hard-code the raiser as Journey Owner** — rejected (D5): only Complaints uses Journey
  Owner; other types need the Responsible Party Manager. Config keeps it per-type.
- **A brand-new appeal entity** — rejected: the existing `appeals[]` lifecycle fits; only
  the actors and the resolution action (Amended Outcome vs Answer Override) change.
- **Drop `resolvedBy` as always-Controls** — rejected: making it explicit keeps tab
  gating data-driven and leaves room if a future type routes appeals elsewhere.

## Consequences

**Positive**

- Appeals fit the new role model with per-type flexibility and no new storage entity.
- Clean two-tab UX (Request / Review) mapping to the two roles.

**Negative**

- The `appealRequest` access cell depends on Case Type config, so it must be
  function-valued and tested per `raisedBy` value.
- Journey Owner's "all cases of type" Summary reach needs a cross-case surface beyond the
  per-Case matrix (a new view + a bounded list query), which is more than a matrix edit.
- CONTEXT.md's **Appeal** entry (QA resolver, Answer Override on agree) is rewritten.

[ADR-0004]: ./0004-case-type-config-as-js-modules.md
[ADR-0007]: ./0007-case-storage-shape.md
[ADR-0011]: ./0011-section-level-role-based-access.md
[ADR-0022]: ./0022-two-axis-role-model.md
[ADR-0026]: ./0026-amend-outcome-case-level-and-qa-retirement.md
