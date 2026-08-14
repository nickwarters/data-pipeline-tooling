# Gold accumulation & what "gold" means

This documents the **gold** layer's load semantics — the `AccumulateByRun`
strategy: rows stamped `logical_run_id` / `load_date`, accumulating across runs,
with an idempotent re-run via *delete-by-logical-run then insert*. For the
*why*, see
[load strategy is per-feed and owned by the Writer](adr/0004-per-feed-load-strategy-owned-by-writer.md);
for the surrounding primitives, [core-primitives.md](core-primitives.md); for the
domain terms (CasePool, SelectionPool, Review Outcomes), [`../CONTEXT.md`](../CONTEXT.md).

## Gold appears in every Pipeline — the framework is reused

Gold is the **accumulating** layer of a medallion. Where raw and silver mirror a
*current-state snapshot* and are full-refreshed each run, gold is the layer whose
**history must survive across runs**.

The medallion (`raw → silver → gold`) is reused by every **Pipeline** — the four
end-to-end phases of the platform, each running its own store(s) through the same
primitives (CONTEXT.md). What gold *holds* depends on the Pipeline:

| Pipeline | Scope | What its gold accumulates |
|----------|-------|---------------------------|
| **Ingest** | per Case Type | A Case Type's Feeds refined to gold; the **CasePool** reads this ingested silver/gold. |
| **Selection** | per Case Type | The chosen Cases — the **SelectionPool** — written into gold and emitted as a Deliverable to the platform. |
| **Sync** | platform-wide | The review platform synced into its **own** store; the **Review Outcomes** live here, the full picture of each case *as the platform sees it*. An outcome can change between runs (see below). |
| **Reporting** | platform-wide | Its own `raw → silver → gold` building cross-Pipeline views (Outcomes joined to selected Cases), shaped into Deliverables (CSV / Excel / JSON, or views read in place). |

So `CasePool` and `SelectionPool` belong to the **Ingest** and **Selection**
Pipelines only; **Review Outcomes** belong to the **Sync** store, *not* to
selection gold. The mutable-record behaviour below is most visible in **Sync**,
where an outcome genuinely changes between runs.

## Load behaviour: accumulate, stamped by run

Every gold row is stamped with two columns:

| Column | Meaning |
|--------|---------|
| `logical_run_id` | The **logical load** this row belongs to — a stable, caller-chosen key (e.g. a business date). It is the **idempotency key**. |
| `pipeline_run_id` | The concrete **pipeline attempt** that wrote the row — the trace key back to the run log. Stamped only when the strategy was derived from a `RunContext`. |
| `load_date` | The date this load represents, carried as a plain column for reporting/lineage. |

A run **accumulates**: a later run adds its rows alongside earlier runs' rather
than replacing them, so history is kept.

### Idempotent re-run: delete-by-logical-run then insert

Re-driving the *same* `logical_run_id` must not duplicate that run's rows, yet
must not touch any *other* run's rows. The writer achieves this by scoping a
delete to the logical run before appending:

```sql
DELETE FROM <table> WHERE logical_run_id = :logical_run_id;  -- clear this run's prior rows
INSERT INTO <table> ...                                      -- then re-insert this run
```

Both statements commit as a **single SQLite transaction**: if the
insert fails, the delete rolls back, so a failed re-run never half-wipes prior
rows. The delete is skipped only on a feed's very first run, when the table does
not exist yet — and that is *probed* (`PRAGMA table_info`), not inferred from a
caught error, so a `database is locked` on the share fails the run instead of
quietly downgrading the replace to an append. The step itself lives in one
place (`_replace_logical_run` in `framework/io/writers.py`), shared by the gold
Writer and the quarantine Writer. The result: re-running a given load is safe and
deterministic, while the historical record of prior loads is preserved.

## `logical_run_id` is *not* the pipeline attempt id

The run-log mints a **fresh `pipeline_run_id` per `.run()`** to
correlate every record of one execution. Gold's `logical_run_id` is a
**different thing** — a stable, logical load key — and the two are kept as
**separate, explicitly named columns**:

- **`pipeline_run_id`** = *this execution* — a fresh id each `.run()`.
- **`logical_run_id`** = *this logical load* — caller-chosen, the
  delete-by-logical-run idempotency key.

Stamping the idempotency key with a fresh-per-execution id would break
idempotency: a re-run would never match prior rows and would silently duplicate
history. So the `AccumulateByRun` strategy takes `logical_run_id` / `load_date`
as **caller-supplied** values — `AccumulateByRun.from_context(context)` derives
them from the shared `RunContext` so `--logical-run-id` flows straight through.
The two are *linked* without being conflated: an accumulated row also carries
`pipeline_run_id` (matching the run-log/registry key), so an operator can
correlate a logical load's rows back to the exact execution that wrote them via
the `RunRegistry`.

## How a changing record is represented across runs

The delete-by-logical-run is scoped to `logical_run_id` **only** — never to a
business key like `case_ref` (`framework/io/writers.py`). So gold **never updates
a record in place**: a record that changes between runs produces *one row per run
that observed it*, each stamped with that run's `logical_run_id` / `load_date`.
The version axis of a record is `(case_ref, load_date)`; `logical_run_id` is the
*load* identity, not a per-row version key.

**Worked example — an outcome that changes (most visible in the Sync Pipeline).**
Because raw/silver mirror the current-state source, each run's silver holds the
record's *current* value, and gold accumulates it:

| Run (`logical_run_id`) | source/silver held | gold after the run |
|----------------|--------------------|--------------------|
| `2026-05-30` | C1 = **Pass** | `(C1, Pass, logical_run_id=2026-05-30, load_date=2026-05-30)` |
| `2026-05-31` | C1 = **Fail** (reviewer changed it) | adds `(C1, Fail, logical_run_id=2026-05-31, load_date=2026-05-31)` — the `2026-05-30` row **stays** |

Gold keeps **both** rows. The change is preserved as history; nothing is mutated.

### Reading the "current" value

The always-correct query is *"the row with the greatest `load_date` for each
`case_ref`"*. Two shapes, depending on what a run writes:

- **Full-snapshot runs** (e.g. Sync re-syncing every case each day): the latest
  `logical_run_id` is itself a complete current-state set, so
  `WHERE logical_run_id = <latest>` is a valid fast path. In a daily load you
  would choose `logical_run_id = the business date`, so `logical_run_id`,
  `load_date`, and "the day" coincide.
- **Subset runs** (e.g. Selection writing only the chosen Cases): the latest
  `logical_run_id` does **not** contain every record, so you must take
  `max(load_date)` per `case_ref` — latest-run alone would miss records last
  written by an earlier run.

This "latest per record" logic lives in **Python** (e.g. on the
CasePool's `fetch_*` retrievals), never in the Writer — the Writer stays a dumb
stamp-and-append. A record that disappears from the source simply stops appearing
in new runs: the current view (max `load_date`) drops it, while its historical
rows remain.

### Two shapes of accumulation, and their costs

`logical_run_id`-stamped accumulation supports two patterns; choose deliberately per Pipeline:

- **Periodic snapshot** — every run re-writes the full set (Sync, ingest). Simple
  and self-correcting, but **unchanged records are re-copied every run**: 10k
  stable records × 100 daily runs ≈ 1M rows, mostly identical. The load-strategy
  design bounds this at ~1M rows; beyond that, change-detection or retention
  becomes a real decision. There is no built-in "is-current" flag — consumers
  derive it.
- **Event / decision log** — each run appends only new facts (selections made,
  outcomes received) that never restate prior rows. This is what gold was
  originally framed around; it grows with events, not with records × runs.

In both, `logical_run_id` is the **unit of replacement**: you can re-drive a whole
load idempotently, but you cannot "correct one record" via delete-by-logical-run —
you re-run the load that produced it.

### A third shape: immutable versions, keyed rather than run-partitioned

Both shapes above make the **run** the unit of identity and replacement. Some
sources don't work that way: a SharePoint list polled several times a working
day yields *observations* that already carry their own immutable id, and the
same observation is deliberately re-read by overlapping poll windows. Stamping
those by run would land the same observation once per run — the run id is not
what makes it unique — and the periodic-snapshot cost above (records × runs)
arrives at intraday frequency.

For that, `AppendOnly(key_columns)` accumulates by the **row's own key** instead:

```python
writer = store.writer("case_version", AppendOnly(key_columns=("source_observation_id",)))
```

An unseen key appends; a re-presented key whose row is unchanged is a no-op, so
an overlapping window costs nothing; a key that arrives with *different* values
raises `AppendOnlyConflictError`, because the source promised immutability and
broke it. Nothing already in the target is updated or deleted.

Choose between them by asking what the unit of replacement is:

| | `AccumulateByRun` | `AppendOnly` |
|---|---|---|
| Unit of identity | the logical run | the row's own key |
| Re-drive | replaces that run's rows | appends only what is missing |
| Re-reading the same rows | lands them again, stamped to the new run | costs nothing |
| A row that changed | a new run's version sits beside the old | a visible failure |
| Volume | records × runs | records |

`AppendOnly` is the wrong choice where rows legitimately restate (a nightly
snapshot of mutable current state) — a changed value there is normal, and
`AccumulateByRun` keeps both versions as history. It is the right choice where a
changed value means the feed is wrong.

## Reading gold concurrently

Gold is the one layer that is *both* written by a pipeline and read by others
(the Selection pipeline reads ingested gold). Reads open through the shared
`connect` factory with a `busy_timeout`, so a read-only client **rides
out** the single writer's in-place commit instead of erroring — it waits for the
lock rather than failing fast. (WAL is unavailable over a network share, so this
is on the default rollback journal.)

## Building a gold hop — compose the write with a strategy

There is no recipe builder for gold; a gold hop is an explicit `Pipeline` whose
**Writer carries the load strategy** that decides the shape. To *accumulate*
validated silver into gold stamped by run, compose an `AccumulateByRun` writer:

```python
from framework.io import AccumulateByRun
from tools.store import StoreRegistry
from framework.run import Pipeline
from tools.medallion import medallion

med = medallion(StoreRegistry("/path/to/share"), "cases")

p = Pipeline("selection_pool")
silver = p.read(med.silver.reader("selection_pool"), name="read")
p.write(
    med.gold.writer("selection_pool", AccumulateByRun.from_context(context)),
    silver,
    name="write",
)
p.run()
```

The `Store` mints the `AccumulateByRunWriter`, which owns the location and the
delete-by-logical-run/insert accumulate behaviour; the
pipeline makes no load decision of its own. `AccumulateByRun.from_context(context)`
derives the `logical_run_id` / `load_date` (and the `pipeline_run_id` trace key)
from the shared `RunContext`, so a re-drive under the same `--logical-run-id`
replaces that load idempotently.

To enforce the schema on the same footing as silver, insert a `SchemaValidator`
validate step before the write (see
[`schema-enforcement.md`](schema-enforcement.md)) — a belt-and-braces guard for
rows assembled at gold rather than mirrored from ingest; no `SchemaCoercion` is
needed because gold reads already-coerced silver. A breach raises *before* the
Writer's delete-by-run/insert transaction, so nothing is deleted or
accumulated and prior gold rows stay intact.

### Current-only gold vs accumulation

Not every gold accumulates. **Ingest** gold is *current-only*: the
`case_review.gold.ingest_silver_to_gold` helper reduces accumulated silver to one
row per Case (`DeriveKey → LatestPerKey → UniqueValidator → Refresh`), so its gold
is a current snapshot, not a per-run history. **Sync** gold is current-only for
the same reason and by the same shape — one row per Case under `Refresh()`, its
change-over-time record held in the accumulated silver beneath it. **Selection**
gold uses `AccumulateByRun`, where history must survive. *Which* model a Case Type's gold
takes — and how multiple feeds fan into it (snapshot-vs-join) — is a per-Case-Type
choice; the `case_review.gold` helpers are where that assembly lives, in the
application layer rather than the framework.

### Two shapes of current-only reduce, and when `LatestPerKey` is the wrong one

`LatestPerKey(key, by="load_date")` reduces a **batch-loaded** silver: every row
a run landed carries that run's `load_date`, so "latest" is "from the most recent
load", and rows that tie inside one load are settled by input order.

A **Polling Feed** breaks both halves of that. `pipelines/sharepoint_cases` polls
a SharePoint list by its `Modified` window and appends one row per observed
*version*, so there is no `load_date` on the row at all — deliberately, because
`AppendOnly` compares every non-key column and a per-read stamp would make each
overlapping re-read look like a changed row. And several versions of one item can
arrive in a single poll, so "last in input order" is not an ordering you can rely
on across an append-only history that many polls have contributed to.

Its reduce is therefore **ordered by the source's own version**, in
`pipelines/sharepoint_cases/gold.py`: one stable sort on `case_id`, the parsed
`source_modified_at`, the *parsed* source version (major, then minor), and
finally the deterministic `source_observation_id`, then keep the last row per
Case. Two details are load-bearing. The version is parsed and never compared as
text — `"10"` sorts before `"9"` lexically — and it handles all three shapes the
column really holds (an ETag `"3"` / `W/"3"` / `"4,1"`, a dotted UI version
`3.0`, and a sha256 digest fallback for a row that carried no version, which
sorts below every real one rather than as NA, because pandas sorts NA *last*).

This stays local to that feed. Generalising it into a framework processor waits
for a second caller with the same problem; until then `LatestPerKey` is untouched
and still right for every feed that carries a `load_date`.

### And a shape where neither reduce is right: Detail Tables

Both shapes above reduce the **Case** table. A **Detail Table** hanging off a
Polling Feed whose observation carries the whole Case — the answers, capture
values and messages folded into one item's JSON blobs — does **not** reduce on
its own key at all. It is semi-joined to the winning
`(case_id, source_observation_id)` pairs the Case reduce produced, so gold holds
the children of the winning observation and nothing else.

Reducing such a table by its own grain looks obvious and is wrong. The review
application *deletes* children between observations — untick the last Remediation
Action, or set Remediation Required to `no`, and the key is destructured off the
Answer entirely. A deletion writes no row, so a child-keyed `LatestPerKey` has
nothing newer to prefer and keeps the deleted child in gold forever. The
semi-join reads the absence correctly, and as a bonus guarantees every gold Case
is assembled from one coherent snapshot.

The rule and its precondition — the observation must carry the *whole* parent —
are recorded in [ADR-0015](adr/0015-detail-tables-reduce-to-the-parents-latest-observation.md).

The implementation is `gold_detail_builder` in `pipelines/sharepoint_cases/gold.py`,
generic over a per-table grain, declared in `DETAIL_GRAIN` — one builder for every
Detail Table rather than a per-table judgement about what "latest" means.

Silver keys a Detail Table's own `AppendOnly` load on a **composite**
key — `answer` on `(source_observation_id, question_id)`, `answer_capture` on
`(source_observation_id, question_id, field_key)`, `answer_action` on
`(source_observation_id, question_id, action_id)`, `general_answer` on
`(source_observation_id, general_key)`, `conversation_message` on
`(source_observation_id, seq)`, `appeal` on
`(source_observation_id, appeal_id)`, `case_detail` on
`(source_observation_id, field_key)` — because the observation alone is not
its grain: one observation yields many child rows, one per question,
catalogue key, message, Appeal or Case Details field (and, for the two
field-level answer tables, one per field or action within that question), and
a single-column key would raise on
the second of any of them for the same Case.

### Aggregating a Detail Table

An Aggregate table normally reduces `case_current` (see `case_counts` above).
Two of `pipelines/sharepoint_cases/gold.py`'s five aggregates —
`answer_remediation_current` and `appeal_outcomes_current` — reduce from a
Detail Table instead: `answer` and `appeal` respectively, named in
`DETAIL_AGGREGATES`.

The source is that hop's **in-memory published dataset**, not silver and not
a re-read of gold — the same reason a Detail Table's own reduction reads
`observations=DatasetReader(current)` rather than re-reading
`case_current` from disk (see *And a shape where neither reduce is right:
Detail Tables*, above). Reading the in-memory dataset means the aggregate
counts exactly the winning observation's rows the Detail hop just wrote, and
works correctly under a dry run, where `Refresh()` writes nothing and a
re-read from disk would see a stale or missing table.

`publish_gold` runs one loop for every aggregate, Detail-sourced or not:
`DETAIL_AGGREGATES.get(table, CURRENT_TABLE)` picks the in-memory dataset
each `(table, step, transform)` entry reads, so the loop needs no branch —
only a table naming a Detail Table as its source is looked up any
differently. A Detail Table's dataset is kept in memory only when
`DETAIL_AGGREGATES` names it as a source, so the other five Detail Tables'
frames are freed once written rather than held for nobody to read.
