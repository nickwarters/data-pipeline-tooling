---
status: accepted
---

# Per-Case Selection explainability via a row trace

A Selection pipeline may be configured with an opt-in **explainability path** via
`.explain(writer, input_node, id_column=…, score_column=None)`. When configured,
the run follows each considered Case across the transform stages and writes a
per-Case **verdict** — selected/excluded, the gate that excluded it, its score,
and a survivor's rank — to a **sibling trace table** stamped with the same logical
and execution identity as the SelectionPool (ADR-0004). The SelectionPool write is
unchanged; the trace lands alongside it.

This is the **eligibility-stage twin of quarantine** (ADR-0007). Both share one
shape — *route aside with a located reason, never silently drop* — at different
stages:

| | Quarantine | Explainability |
|---|---|---|
| Stage | **Validity** (silver schema) | **Eligibility** (Selection) |
| Question | "is this row well-formed?" | "why was this Case (not) chosen?" |
| Shape | partition **once** into good/rejected | follow each Case across **every** stage |
| Lands | reject table, `failed_rule` | trace table, `verdict`/`reason`/`score`/`rank` |

## Why — a governed act needs a defensible record

This is a review/**governance** platform: *which Advisers' Cases get reviewed* is
itself a governed decision that will be challenged after the fact ("why wasn't this
Adviser picked up last quarter?"). The Selection transforms (`Filter`/`Score`/
`Sort`/`JoinWith`) carry plain-Python callables (ADR-0002) that would otherwise
**silently drop** Cases, leaving no trace. Visibility over silence, applied to
eligibility: an excluded Case is never silently absent — it lands in the trace
with the gate that excluded it, a run correlation, and a date.

## How — a ledger watches the stages run

Selection narrows through a *sequence* of transforms, so the trace cannot be a
single partition. A generic `RowTrace` ledger seeds with the considered
population, observes each transform stage, then finalizes against the surviving
SelectionPool:

- A Case present *before* a stage and absent *after* was **dropped by that stage** —
  the first such drop excludes it, located by the stage's name. This is generic
  over `Filter`, inner `JoinWith`, and `AntiJoinWith` alike.
- A `Score` stage **snapshots** the score for every Case still present, so a Case a
  later gate excludes still carries the score it earned.
- Survivors record the gates they passed and their **rank** — their 1-based
  position in the final sorted SelectionPool order.

Transforms expose a light `trace_role` / `trace_name` so the ledger can locate
reasons without the builder type-sniffing; `Filter`/`JoinWith`/`AntiJoinWith` take
an optional `name=` to label the gate.

## Trace table schema

Every considered Case lands one row: `<id_column>`, `verdict`
(`selected`/`excluded`), `reason` (located, e.g. `excluded by filter
'high-value'`), `score` (retained even for excluded Cases; omitted if no
`score_column`), `rank` (1-based among survivors, null for excluded), and the run
identity (`run_id`, `logical_run_id`, `load_date`, `execution_id`).

## Consequences

- Explainability is **not the default**: a Selection pipeline with no `.explain()`
  node is unaffected (the same opt-in design as quarantine). The trace table is
  independently-committed evidence (ADR-0005).
- `RunLog` records an `explain` step with `rows_in` (Cases considered), `rows_out`
  (Cases selected), and `rows_excluded`.
- The trace describes a **single run**. Re-deriving what Selection *would* have
  picked "as of" a past date is a distinct concern (reproducible against
  accumulated silver — ADR-0010 covers the sampler's part), deferred to a
  follow-up.
- Attribution is **stage-positional**: a Case is attributed to the first stage that
  drops it, so the id column must survive every stage for the trace to hold.
</content>
