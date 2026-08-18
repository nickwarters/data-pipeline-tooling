# 50. A required General Question gates the send, not the Outcome

Date: 2026-08-18

## Status

Accepted. Amends the General Question as introduced in
[ADR-0004](./0004-case-type-config-as-js-modules.md)'s Case Type configuration
surface, and narrows one clause of CONTEXT.md's entry for the term.

## Context

General Questions were built as the deliberately inert half of the Review tab:
Case Type-configured fields a Reviewer answers beside the Applicable Questions,
namespaced `general:<key>` in the Answers blob so that no catalogue-driven
evaluator can see them. CONTEXT.md stated the containment as four things being
unaffected — applicability, Question Group progress, **completion gating** and
the Outcome — and the code held that promise by construction: `allAnswered`
walks `evaluate(catalogue, answers)`, and a `general:` key is in no catalogue.

The consequence was that a General Question could be ignored with no cost. A
Reviewer could complete a Case having answered none of them, and the Case Type
Owner reading the Summary roll-up afterwards could not tell a question that was
considered and had nothing to say from one that was never read. For a question
like "How was this Case reviewed?" that is not a gap in reporting, it is a gap
in the evidence: a Case reviewed on the file alone and one reviewed against the
call recording are not the same review, and afterwards nothing distinguishes
them.

So the question was whether "inert" was one property or two. It was two, and
they had been bundled: _what the Case concludes_ and _when the Reviewer may
conclude it_.

## Decision

**A General Question may be marked `required`, which holds the pre-send
transition and nothing else.**

`required: true` on a `GeneralQuestionField` — the same key an Issue Capture
Field already carries, meaning the same thing — makes the Summary tab's
**Send Actions** / **Complete Case** control disabled-with-its-reason until the
question is answered. It joins the three pre-send content gates already there
(the "Is remediation required?" decision, the required Issue Capture Fields, the
Responsible Party) and is named **first** of the four, because the Review tab
comes before the Issues tab and a Reviewer sent back through both should be sent
back in reading order.

Everything else about the containment is unchanged and is now stated as three
things, not four: applicability, Question Group progress and the Outcome remain
unaffected. The gate is not a hole in the namespace, because it does not read
the catalogue at all — `unfilledRequiredGeneralQuestion` walks the **Case
Type's declared field list**, an input no evaluator has. That is the whole
reason the two properties can be separated: a required General Question changes
when a Case may be sent and contributes nothing to what it says.

### The gate is pre-send only

It holds `In-progress` → `Actions In Progress` / `Completed`, and is not asked
again at the final close of an `Actions In Progress` Case. Nothing can pass the
send unanswered, so re-asking could only ever strand Cases sent before this
decision — a gate whose sole population is Cases it was never meant to catch.

### `required` is declared per Case Type, not in the shared catalogue

The shared catalogue in `case-types/general-questions.js` fixes a question's key
and forbids an including Case Type from rewording it, because the same key
behind two different questions splits reporting silently. `required` is exempt:
it is not part of what the question _asks_, it is how hard one Case Type presses
for an answer, and two Case Types may reasonably differ while asking the same
thing. An inclusion may therefore carry it — `{ key: 'reviewChannel', required:
true }` in place of the bare key — and may carry **nothing else**, which is
refused at load time naming the offending keys. That refusal is the first
mechanical enforcement of the no-rewording rule, which until now was a comment.

The alternative — `required` in the catalogue definition — was rejected for
making one Case Type's policy every Case Type's, and for putting a policy field
inside the object whose stated job is to word the question.

### Rejected: every General Question required

The simplest rule, and it fails on the catalogue's own contents.
`reviewerObservations` is an invitation to feed something back to the Case Type
Owner; insisting on it produces "n/a" and teaches Reviewers that the gate is
noise. A gate everyone routes around is worse than no gate, because it still
costs a click.

## Consequences

- **Complaints now requires `reviewChannel`.** The only live Case Type marks
  "How was this Case reviewed?" required and leaves observations optional. An
  in-flight Case that has not answered it sees the completion control disabled
  with the reason until the Reviewer does — including Cases opened before this
  change, since the gate reads the live Answers rather than a stamp.
- **A Case Type marking nothing `required` is gated exactly as before.** The key
  is absent from every other declaration, and an inclusion that omits it does
  not invent a `required: false` for the gate to interpret.
- **The Reviewer is told, not blocked silently.** The control stays visible and
  disabled with its reason, as the remediation and Responsible Party gates
  already do; only the Assigned Reviewer sees it, since the permission half is
  checked first. The section it names is always on that viewer's page — the only
  role that can reach this gate holds `edit` on the Review tab — so the reason
  can never point at a control the reader cannot see.
- **No visual required marker.** Issue Capture Fields carry `required` with no
  asterisk or `aria-required` either; adding one for General Questions alone
  would put two conventions in the app. If a marker is wanted it is one change
  covering both, not this one.
