# Framework simplification review

A record of the review that produced
[ADR-0027](adr/0027-eager-steps-are-the-default-authoring-model.md), the
measurements behind it, and the backlog it left. Written down because the
conclusions reversed twice as evidence arrived, and the reversals are the most
useful part.

**The question asked:** how do we cut down the concepts and wiring needed to get
a pipeline up and running? The scaffolded pipeline looks daunting and
over-complicated.

**The answer arrived at:** the concept count was real but secondary. The barrier
was that the framework could not be step-debugged, and step-debugging is how the
team reads code.

## What was measured

All figures taken from the tree at review time, by parsing rather than reading.

### The public surface

| | |
|---|---|
| Names exported across the four facades | **121** (core 35, io 40, transform 29, run 17) |
| …never imported by `pipelines/`, `case_review/`, `readers/`, `shared/` | **66** |
| …imported exactly once | 5 |
| ADRs | 26 |
| Root `docs/` | 12,044 lines (`adding-a-feed.md` alone: 1,066) |
| `framework/` + `tools/` + `cli/` | 16,371 lines |

**59% of the public vocabulary has one call site or none.** Caveat recorded at
the time and still standing: the count covers application code, not tests. Some
of the 66 are exercised by tests only — real API with no production consumer,
which is a different problem from dead code and should be separated before
anything is deleted.

### The cost per pipeline

Across all 20 `pipelines/*/pipeline.py` (4,205 lines):

| Measure | Count |
|---|---|
| Lines that are module docstring + imports + `main()` | **24%** (994 lines); 27–58% for ingest-shaped feeds |
| Node wirings (`p.read/transform/validate/write/...`) | 211 |
| `name="..."` arguments | **278** — more names than nodes |
| `run_log` as builder param / pass-through / `context.run_log` | **78** |
| `StoreRegistry(` + `medallion(` | 33 |
| `if describe: print(x.describe())` blocks | **17**, copy-pasted |
| `Pipeline(` constructed / `.run()` called / `*_builder` defined | 36 / 34 / 31 |

`complaints_a`, `complaints_b` and `complaints_c` are identical apart from one
constant and three comments — 109 lines each for one line of difference.

### Whether the graph was earning its keep

Parsed with `ast`, counting input nodes per wiring:

| Wiring | Count |
|---|---|
| Nodes with exactly **one** input | 161 |
| Nodes with 2–3 inputs (true fan-in) | 8 |
| `depends_on=` edges | 1 |

The eight are in `notifications` and the `retail_analytics` demo. 95% of
pipeline code is a straight line described as a graph.

### Streaming

Honest count (excluding `upstream` false positives): **513** mentions across
`framework/` + `tools/` + `cli/` — 139 of them in `builder.py`, the file every
author reads — plus 331 doc lines and 11 test files. Thirteen facade names, all
already in the never-used list.

Its real cost is not lines but **rules**: streaming is the sole reason the
builder must refuse four pairings at wiring time (target-replacing writer,
`whole_dataset` validator, `explain`, a second streamed source) and the sole
reason `UniqueValidator` vs `StreamingUniqueValidator` is a choice an author has
to make.

## What changed the conclusion

Three pieces of evidence, each of which reversed something.

1. **"The DAG is right for the complex pipelines, keep it."** Reversed by
   counting: 161 of 169 wirings are single-input. The API had been read, not its
   use.
2. **"Location and strategy can both come from the context."** Reversed by the
   team: different pipelines need different write strategies. `base_dir` is
   *environmental* — the same pipeline in dev and prod. The load strategy is a
   *design decision of the pipeline* — the same in every environment. They
   belong in opposite places. Only location moves.
3. **"Maintainers are you and one or two others; ops only need three CLI
   commands."** Reversed by the team: everyone is expected to author and
   maintain, and everyone works in PyCharm by stepping through code. That
   collapsed the three-audience framing the review had been built on and pointed
   at the execution model.

The decisive datum: the second-most-experienced engineer, a week into
`pipelines/ingest` — the simplest pipeline here, estimated at half a day — with
barely a grasp of what was needed.

## A defect found while tracing this

The scaffolded `--case-type` `main()` registered with `PipelineRunner` under a
subject, so the same feed had **two run identities** depending on how it was
started:

| Started by | run-history label | `logical_run_id` |
|---|---|---|
| `python -m pipelines.myfeed.pipeline` | `myfeed/myfeed` | `myfeed/myfeed:2026-08-19` |
| `python -m cli run pipelines/myfeed` | `myfeed` | `myfeed:2026-08-19` |

Both write the same log file, so nothing looks wrong. Two consequences: a
downstream `FreshnessRequirement("myfeed")` finds no history for the other
spelling and treats a stale upstream as a first run; and because
`logical_run_id` is the key `AccumulateByRun` deletes by, a re-drive through the
other entry point *accumulates* rows instead of replacing them.

Fixed here — every `main()` now calls the same `run_pipeline` the CLI uses.

## What was implemented

See [ADR-0027](adr/0027-eager-steps-are-the-default-authoring-model.md) for the
decision and its consequences.

- `framework/run/steps.py` — eager `read` / `transform` / `validate` / `write` /
  `coerce` / `enforce` / `quarantine` / `step`, exported from `framework.run`.
- `pipelines/ingest` converted (raw and silver eager; the shared gold reduce
  left deferred on purpose, as the worked example of the two interoperating).
- Both scaffold templates render eager pipelines, with `enforce` collapsing the
  coerce → quarantine → validate sequence and hops renamed `*_builder` → `*_hop`.
- Every scaffolded `main()` routed through `run_pipeline`, closing the
  divergence above.
- `tests/framework/run/test_steps.py` — 21 tests over what the steps return and
  what they record, including the dry-run, warn-severity, no-context and
  builder-interop paths.

Verified end to end: all three scaffold variants (plain, `--from-feed-file`,
`--case-type`) generate feeds whose tests pass out of the box; `cli run
pipelines/ingest` lands 5 rows through raw → silver → gold; a re-drive leaves
5, not 10; `--dry-run` writes nothing.

## Backlog, in the order recommended

Nothing below is implemented. Each is independent of the others.

1. **`source()` column mapping.** A feed's columns are declared in four places
   that must agree — the dataclass, `SELECT_RAW_COLUMNS`, `RAW_FEED_COLUMNS` /
   `RENAME`, and the migration DDL. Collapse to one declaration per column
   holding all three facts (our name, our type, their name), and derive the rest
   including the baseline DDL. Highest value for a team whose feeds arrive with
   the upstream's vocabulary. Note that `--from-feed-file` today only
   *canonicalises* (`CSE_REF_NO` → `cse_ref_no`); it cannot map to domain terms.
   Open question first: are the upstream column names stable month to month? If
   they drift, this needs a versioning story that a hand-edited `RENAME` dodges.
2. **Delete streaming.** 513 mentions, four wiring rules, a third of
   `builder.py`; the team has other workarounds.
3. **Arrival gating for multi-file feeds.** There is no file-arrival concept:
   `FreshnessRequirement` asks about an upstream *pipeline's* run history, and
   `GlobCsvReader` raises only when **zero** files match. A monthly feed of
   three files where one arrives later therefore runs on partial data and
   records success. Silent-partial-success, of exactly the kind
   [`pull-request-review.md`](pull-request-review.md) warns about.
4. **Convert the remaining 19 pipelines** to eager steps. Mechanical: argument
   order was kept identical for this reason.
5. **Delete `PipelineRunner`.** Now used by nothing (the CLI and the
   orchestrator both go `load_pipeline` → `run_pipeline`).
6. **Trim the facades.** Drop the writer classes that duplicate their strategy
   (`Refresh`/`SqliteTruncateReloadWriter`, `AppendOnly`/`SqliteAppendOnlyWriter`,
   …) and split the streaming and remote families out of `framework.io`.
7. **`context.medallion(subject)`.** Removes 33 mentions of store plumbing, but
   conflicts with the existing decision that the medallion is *not* framework
   vocabulary — so it needs its own ADR, not a quiet addition.
8. **Split `docs/adding-a-feed.md`** (1,066 lines) into a ~60-line "add a feed"
   page and a separate reference for SAS / SharePoint / wide feeds.
9. **Drop `profile` / `action` / `task` from the builder.** Combined usage
   across every pipeline: zero.

## The test worth running before any of it

Have the engineer who will maintain the monthly three-file feed write it, with
support but not driving, against this branch. Whatever they reach for and cannot
find, and whatever they misuse, is the real backlog — measured rather than
argued. If it takes a day, what remains is a documentation and tooling problem.
If it does not, the next thing to cut will name itself.
