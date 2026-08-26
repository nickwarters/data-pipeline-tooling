---
status: accepted
---

# Detail Tables reduce to the parent's latest observation, never to their own latest row

A **Polling Feed** whose source delivers a whole parent record per observation —
one SharePoint list item carrying its children in JSON blobs — reduces its
**Detail Tables** to gold by **semi-joining them to the winning
`(case_id, source_observation_id)` pairs** produced by the Case table's reduce.
Gold therefore holds every child row belonging to **the one observation that won
for that Case**, and nothing else.

It is **never** reduced by `LatestPerKey` over the Detail Table's own grain
columns (`(case_id, question_definition_id, capture_field_key)` and friends),
even though that is the reduction the table's own shape suggests.

## Why

- **A child-keyed reduce is structurally blind to deletion.** The review
  application removes children from a Case's blobs when the Reviewer changes
  their mind. This is deliberate, and the frontend says so in
  `platform_frontend/src/pages/cora-case-review/answer-actions.js`: setting
  **Remediation Required** to `no` destructures `remediationActions` and
  `freeFormRemediation` off the Answer ("an action persisted under a control the
  Reviewer can no longer see would show up in reporting as remediation nobody
  intends to do"), and the same pattern drops the key when the last action is
  unticked or free-form text is cleared. Issue Capture values are stripped the
  same way when an Answer stops failing.

  The failure that follows is silent and permanent:

  | | What the poll sees | `answer_action` rows landed |
  |---|---|---|
  | Monday | Case 42 / Q7 has `remediationActions: [{id: "A1"}]` | one row for A1 |
  | Tuesday | Reviewer sets Remediation Required = no; the key is gone from the blob | **none** |

  Reduce by the child's own key and A1's *only* row is Monday's — so Monday's is
  the latest row that exists, and **A1 survives in gold forever**. There is no
  Tuesday row saying "A1 is gone", because an absence does not write a row. No
  amount of care in the child pipeline recovers this: the information simply is
  not in the child table.

  The semi-join reads the deletion for free. Tuesday's observation wins for
  Case 42, Tuesday produced no `answer_action` row, so no `answer_action` row is
  in gold.

- **It makes each gold Case internally consistent.** Every child row in gold
  comes from one snapshot of one Case, so answers, capture values and messages
  can never mix state from two different syncs. A per-child-key reduce gives no
  such guarantee — it assembles a Case that never existed, from the newest
  fragment of each child independently.

- **It is one rule for N tables.** Seven Detail Tables reduce identically,
  through one generic `to_gold_detail` driven by a per-table grain
  registry, rather than a per-table judgement about what "latest" means for
  each.

- **It is not derivable from the child table alone,** which is why it is an ADR
  and not a comment. The obvious reduction is the wrong one, the wrongness never
  raises anything, and each future feed author would have to rediscover it.

## Considered options

- **`LatestPerKey` over the Detail Table's own grain.** The shape the table
  suggests, and wrong for the reason above. Rejected.
- **Synthesise tombstones by diffing consecutive observations.** Correct, but it
  needs the previous observation in hand at silver, adds a delete-marker column
  to every Detail Table, and arrives at exactly the row set the semi-join
  already produces. More machinery for the same answer. Rejected.
- **Reduce children independently and reconcile against the parent blob on
  read.** Puts the blob walk back in every consumer, which is the thing this
  whole normalisation exists to remove. Rejected.

## Consequences

- **Every child row must be stamped with its parent's observation metadata**
  (`case_id` + `source_observation_id`) at silver. This is a hard requirement of
  the reduction, not a lineage nicety — the semi-join has nothing to join on
  otherwise.
- **The precondition is that the observation carries the whole parent.** The
  rule is sound because one poll returns one Case's complete current state,
  children included, so "absent from the winning observation" honestly means
  "deleted". A feed whose children arrive *independently* of their parent
  (separate file, separate list, separate window) breaks that inference, and
  this ADR does not apply to it — there, an absence means "not delivered this
  time", not "gone". State the precondition when reusing the rule.
- **A Case whose winning observation has no children yields no child rows**, and
  that is the correct answer, not a lost join. Referential expectations between
  a Case and its Detail Tables stay read-side concerns, per ADR-0009.
- **The Case table's reduce is unchanged** — still latest-per-`case_id`, ordered
  by the source's own version for a Polling Feed (see
  [gold-accumulation.md](../gold-accumulation.md)). This ADR governs what the
  *children* do with the winner it picks.
- **Silver still accumulates every observation**, so the history a child-keyed
  reduce would have preserved is not lost — it is simply not what gold is for.
  "What did this Case look like on Monday" is a silver question.
- **Hard deletion of the parent item is still unhandled.** An item deleted in
  SharePoint never appears in a `Modified` window at all, so its last
  observation wins forever. That is a reconciliation-sweep concern, out of scope
  here; in-app a Case is Voided, never deleted.
