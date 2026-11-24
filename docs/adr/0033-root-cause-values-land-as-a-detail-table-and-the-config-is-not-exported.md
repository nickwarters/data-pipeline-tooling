---
status: accepted
---

> **Amended (2026-11):** the review application gained a `multiselect` field
> type, the first value shape here that is neither text nor a person, and one
> of the cases "What would reopen it" names. It is modelled rather than
> quarantined, in both tables at once through the shared
> `discriminate_capture_value`: a non-empty list of strings is stamped
> `options` and lands as **one row** per field, its `value_text` the options
> joined on `|` — the rendering `derive_value_text` already gives a
> multi-choice answer, so the subject keeps one rule for a list of chosen
> options rather than two. One row per option was considered and declined:
> it would change the tables' grain, `(…, question_id, field_key)`, and so
> their migrations, for a gain a per-Case-Type Reporting pivot can still make
> by splitting. A date remains unmodelled and still quarantines.

# Root Cause values land as a Detail Table, and the field configuration is not exported

The Case Review Platform's Root Cause tab lets the **Responsible Party
Manager** record, for each failed Answer, the fields its Case Type declares.
The values live inside the existing `Answers` blob, as a per-Answer
`rcaCapture` map beside the Reviewer's `capture` map, with the same value
shape: a string, or a person as `{loginName, displayName}`. No SharePoint
column carries them.

**They land as one more generic key/value Detail Table, `answer_root_cause`** —
silver grain observation × `question_id` × `field_key`, gold grain `case_id` ×
`question_id` × `field_key` — a twin of `answer_capture`, built by the same two
chained explodes and the same `discriminate_capture_value`, quarantined and
reduced the same way. A person named in `rcaCapture` reaches the `person` table
exactly as one in `capture` does.

**The Root Cause field configuration** — which fields a Case Type declares,
their labels, types and a select's options — **stays in the frontend's Case
Type modules and is not exported to the pipeline.**

## Why

- **One generic table, not typed columns.** The fields are declared per Case
  Type, in frontend config this pipeline cannot see, and differ between Case
  Types. A typed column per field would make every Case Type's Root Cause
  design a migration to a shared table that holds every Case Type
  ([ADR-0016](0016-one-sync-subject-for-every-case-type.md)) — the same reason
  `answer_capture` and `case_detail` are key/value rather than wide. A typed,
  per-field view belongs to a per-Case-Type Reporting pivot, which knows the
  config it is pivoting on.
- **A separate table, not more rows in `answer_capture`.** The values share a
  shape with the Issue capture but not a meaning: one is the Reviewer's record
  of the Issue, the other the Manager's account of why it happened, written by
  different people at different stages. One table would need a discriminator
  column every existing consumer of `answer_capture` would have to learn to
  filter on, and its migration would change a deployed table's shape; a sibling
  table changes nothing that already exists.
- **The config is not exported yet, because nothing needs it yet.** Exporting
  it would mean either widening the question-bank export, which would change
  every bank's version identity for a change that is not about questions, or a
  sibling export plus a Shared Reader
  ([ADR-0026](0026-shared-readers-declare-cross-subject-reads.md)) — a new feed
  for a consumer that does not exist. Without it `field_key` lands unvalidated
  and unlabelled, which is exactly how `answer_capture.field_key` and
  `case_detail.field_key` land today.

## Consequences

- No aggregate counts Root Cause values. A free-text field is close to one
  value per Case and a person is an identity, not a measure — the reason a
  capture-value count was refused — and without the config a count cannot tell
  a select's closed options from free text, nor label a field. A report reads
  gold `answer_root_cause` directly.
- A team roll-up of Root Causes joins `case_current` on `case_id` and chooses
  its manager deliberately: `responsible_party_manager_name` is the record (who
  managed the Responsible Party when they were set on the Case) and is what the
  existing reporting reads; `current_responsible_party_manager_name` is who
  manages them now. They agree until someone's manager changes.
- An Answer without `rcaCapture` — every Answer on a Case Type that declares no
  Root Cause fields — contributes no rows; that is not an error.
- Raw and `case_version` are unchanged: the values arrive inside a blob they
  already land.

## Amendment: Case Root Cause Fields (2026-11-24)

Some of what the Responsible Party Manager records is about the whole Case
rather than one failed Answer — for Complaints, whether a supervisor has
checked the Case, whether No Fault has been requested and whether a
development plan has been created. The frontend stores these, still with no
new SharePoint column, as one more entry in the `Answers` blob under the
namespaced key `case:rootCause`, shaped like an Answer (`value: ''`) with the
fields in its `rcaCapture` map.

**They land in a sibling Detail Table, `case_root_cause`** — silver grain
observation × `field_key`, gold grain `case_id` × `field_key` — built by the
same explode and discriminator as `answer_root_cause` over that one entry.
Not rows in `answer_root_cause` with a sentinel `question_id`: that table's
grain says every row belongs to a Question Definition, and a report joining
`question_id` to the catalogue would meet a key that is none.

Because the `Answers` map now holds two namespaces, the per-question explodes
(`answer`, `answer_capture`, `answer_action`, `answer_root_cause`) exclude every
prefix in `NAMESPACED_ANSWER_PREFIXES` (`general:`, `case:`), and their
`question_id` carries `Pattern([^:]+)`. The frontend refuses a `:` in a
Question Definition id, so the pattern diverts no real Answer; a namespace
added later that this feed has not been taught quarantines instead of landing
silently as an Answer nobody declared — which is what `case:rootCause` would
have done before this amendment.

## What would reopen it

- A report that needs Root Cause fields labelled, typed or limited to declared
  keys — that is the consumer an export of the config waits for, and the point
  to choose between widening the question-bank export and a sibling export.
- A Root Cause value whose shape is neither text, a person nor a list of
  options (a date, say) — `discriminate_capture_value` quarantines it today,
  and modelling it would change both tables' discriminator together. (A
  multi-select reopened this once; see the amendment above.)
- The frontend moving Root Cause out of the `Answers` blob, into a column or a
  list of its own — then this table's source changes, not its grain.
