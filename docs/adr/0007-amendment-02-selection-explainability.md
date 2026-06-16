---
status: accepted
amends: 0007-fail-fast-atomic-runs-jsonl-observability.md
---

# ADR-0007 Amendment 02 — Per-Case Selection explainability using RowTrace

## Decision

A Selection pipeline may be configured with an opt-in **explainability path** via
`.explain(writer, id_column=…, score_column=None)`. When configured, `.run()`
follows each considered Case across the processor stages and writes a per-Case
**verdict** — selected/excluded, the gate that excluded it, its score, and the
survivor's rank — to a **sibling trace table** stamped with the same logical and
execution identity model as the SelectionPool. The SelectionPool write is
unchanged; the trace lands alongside it.

This is the **eligibility-stage twin of quarantine** (ADR-0007 amendment 01).
Both share one shape — *route aside with a located reason, never silently drop* —
but at different stages:

| | Quarantine (amd 01) | Explainability (amd 02) |
|---|---|---|
| Stage | **Validity** (silver schema) | **Eligibility** (Selection) |
| Question | "is this row well-formed?" | "why was this Case (not) chosen?" |
| Shape | partition **once** into good/rejected | follow each Case across **every** stage |
| Lands | reject table, `failed_rule` | trace table, `verdict`/`reason`/`score`/`rank` |

## Why — a governed act needs a defensible record

This is a review/**governance** platform: *which advisers' Cases get reviewed* is
itself a governed decision that will be challenged after the fact ("why wasn't
this adviser picked up last quarter?"). Today `Filter`/`Score`/`Sort`/`JoinWith`
carry plain-Python callables (ADR-0002) that **silently drop** Cases, leaving no
trace. Management raised auditable selection as a requirement (issue #53).

Visibility over silence (the amendment-01 principle) applied to eligibility: an
excluded Case is never silently absent — it lands in the trace with the gate that
excluded it, a run correlation, and a date.

## How — a ledger watches the stages run

Selection narrows through a *sequence* of processors, so the trace cannot be a
single partition. The framework provides the generic `RowTrace`
(`framework/run/trace.py`) ledger, while the case-review pipeline chooses the Case
identity column and sibling selection-trace writer:

- The pipeline **seeds** it with the considered population (the rows entering the
  stages), then lets it **observe** each processor stage, then **finalize**s it
  against the surviving SelectionPool.
- A Case present *before* a stage and absent *after* was **dropped by that
  stage** — the first such drop excludes it, located by the stage's name. This is
  generic over `Filter`, inner `JoinWith`, and `AntiJoinWith` alike (AC1, AC5).
- A `Score` stage **snapshots** the score for every Case still present, so a Case
  a later gate excludes still carries the score it earned (AC2).
- Survivors record the gates they passed and their **rank** — their 1-based
  position in the final (sorted) SelectionPool order (AC4).

Processors expose a light `trace_role` / `trace_name` so the ledger can
locate reasons without the builder type-sniffing; `Filter`/`JoinWith` /
`AntiJoinWith` have an optional `name=` to label the gate.

## Trace table schema

Every considered Case lands one row in the configured trace table:

| Column | Meaning |
|---|---|
| `<id_column>` | the Case identity (e.g. `case_ref`) |
| `verdict` | `selected` or `excluded` |
| `reason` | located: `passed high-value, not-x` or `excluded by filter 'high-value'` |
| `score` | the `score_column` value, retained even for excluded Cases (omitted if no `score_column`) |
| `rank` | 1-based rank among survivors; null for excluded |
| `run_id`, `logical_run_id`, `load_date` | stamped by the Writer's `AccumulateByRun` strategy as the logical/idempotency run metadata |
| `execution_id` | stamped when the strategy is derived from `RunContext`; correlates to RunLog/RunRegistry |

## Observability

When `.explain()` is configured, `RunLog` records an **`explain` step** with the
governance counts (AC6):

- `rows_in` — Cases **considered** (entered Selection)
- `rows_out` — Cases **selected** (survived to the SelectionPool)
- `rows_excluded` — Cases a gate **excluded**

`rows_excluded` is now a first-class field in the JSONL run-log schema; the
deferred run-registry (ADR-0005) should expect it on `explain` steps.

## Consequences

- Explainability is **not the default**: a Selection pipeline with no `.explain()`
  call is unaffected (the same opt-in design as quarantine).
- The trace describes a **single run**. Re-deriving what Selection *would* have
  picked "as of" a past date — reproducibility against accumulated silver (#38) —
  is a distinct concern, **deferred** to a follow-up; this amendment covers the
  trace of a run, not the re-derivation of a past one.
- Attribution is **stage-positional**: a Case is attributed to the first stage
  that drops it. A processor that drops rows for reasons other than an
  eligibility gate (e.g. a misconfigured `SelectColumns` removing the id column)
  would mis-locate — the id column must survive every stage for the trace to hold.
