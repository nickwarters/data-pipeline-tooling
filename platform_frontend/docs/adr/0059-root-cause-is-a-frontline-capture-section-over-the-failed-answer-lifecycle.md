# 59. Root Cause is a frontline capture Section over the failed-Answer lifecycle

Date: 2026-10-19

## Status

Accepted. Planned with the owner in the Root Cause implementation plan, whose
open questions they answered there. Amends
[ADR-0020](./0020-unified-issue-capture-engine.md) (the capture engine writes a
second slot),
[ADR-0023](./0023-case-lifecycle-and-reportable-milestone.md) (a second Answers
write after the reportable milestone, by a second Role),
[ADR-0024](./0024-remediation-tracking-tab.md) (remediation resolution is no
longer the only post-reportable Answers write) and
[ADR-0038](./0038-manager-fields-split-reporting-snapshot-vs-live-access-role.md)
(the current-manager Role gains an edit right beyond the Conversation).
Supersedes nothing.

## Context

The Issues tab is where the Reviewer records detail against each failed Answer.
Some Case Types also want the frontline view: the Responsible Party Manager,
who manages the person being assessed, saying why each Issue happened. That has
to be configurable per Case Type, off entirely for most, and only open once the
Case is reportable, because before then the Issues can still change.

Everything such a tab needs already exists for the Reviewer: typed, grouped,
conditional fields declared per Case Type (`captureGroups`), one engine that
validates and prunes them, a view that renders them, and a failed-Answer
lifecycle that strips them when the Answer stops failing.

## Decision

**A new Section, `rootCause`, tabbed and headed "Root Cause".** It lists the
Case's Issues (every active, applicable, failed Question, not only those with
remediation) and under each renders the Case Type's `rootCauseGroups` with the
same `CaptureGroups` view the Issues tab uses.

**One engine, two slots.** The values are stored in each failed Answer's
`rcaCapture`, beside the Reviewer's `capture`, inside the Answers blob.
`applyCapture` and `unfilledRequiredCapture` take the slot they write as a
parameter, so validation, `showWhen` pruning and the `required` rule are the
Issue capture rules, applied to the other slot. Keys are unique within
`rootCauseGroups`, not across both families, because the slots never share a
namespace. Nothing existing is renamed: the Complaints Issue Capture Group
`root-cause` and its `rootCauseSummary` field stay the Reviewer's.

Storing it inside the Answers blob rather than in a new column means no list
needs provisioning and the pipeline already holds the blob. The cost is that the
manager's writes and the Reviewer's remediation resolutions share one ETag: if
both save the Answers between the other's load and save, the second sees the
existing conflict banner and reloads. Nothing is silently lost.

**Access.** Hidden for everyone unless the Case Type declares
`rootCauseGroups`, the Case has reached the reportable milestone and it carries
an Issue. Then the current Responsible Party Manager edits it while the Case is
`Actions In Progress` or `Completed`, so a cause can still be written after the
Reviewer has closed the Case; on a Case voided after the milestone the manager
reads it like everyone else. The reviewer side, including Controls, reads it.
The Responsible Party does not see it: what their manager records about the
cause of their Issues is not theirs to read.

The Section gates on `rootCauseGroups` itself rather than relying on the
`sections` allow-list alone, because the Case loader does not yet apply that
allow-list when it resolves access. The verify gate holds the two keys in step:
groups declared but the Section left out of an explicit `sections`, or the
Section listed with no groups, is a named failure.

**Lifecycle.** `rcaCapture` joins the failure-lifetime keys, so it is stripped
with the failure when an Answer stops failing and a re-failed Answer starts
empty. A Reopen keeps Answers untouched, so it keeps the Root Cause too; the tab
hides until the Case is reportable again.

**No completion gate.** A `required` Root Cause Field is shown as still to
record, under its Issue and in the Summary block, and holds no transition.
Every existing gate holds the Reviewer's own transition on the Reviewer's own
input; holding it on a frontline manager's fields is a cross-role coupling
nothing has today. If a Case Type comes to need it, it is a per-Case-Type
switch holding only the final Complete (never the no-actions Complete, which has
no manager to wait on) on `unfilledRequiredCapture(…, 'rcaCapture')`, and an
amendment to this ADR.

**Person fields** are allowed in `rootCauseGroups`. The page holds their people
searches in their own route field, `rcaCaptureSearch`, beside the Issues tab's
`captureSearch`, with their own debounce: a Root Cause Field may share a key with
an Issue Capture Field on the same Answer, and a search keyed by Question and
field alone would let one picker show, or close, the other's matches. The
loader refreshes a stored person's display name in both slots in the one
directory call it already makes.

## Consequences

- A Case Type turns the tab on with two keys and the field declarations; the
  scaffold leaves it off.
- The Responsible Party Manager's Role now writes Answers. The SharePoint ACL
  already lets that group edit the item, because it posts in the Conversation;
  there is no column-level permission to add.
- The pipeline needs a Detail Table for `rcaCapture`, as it has `answer_capture`
  for `capture`. That is the data pipeline's change, made beside this one.
- The Case Type config is still not exported, so the pipeline cannot tell
  "switched off" from "nothing recorded yet". That stays deferred until a report
  needs it.
- Nothing tells the manager there is a cause to record. They reach the Case
  through the existing Conversation and Reportable notifications; a "root cause
  outstanding" notification is later work.
