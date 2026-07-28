# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

The **walking skeleton** is in place: the CSV → raw path through the
core primitives. Architecture is governed by the ADRs in `docs/adr/` and the
domain language in `CONTEXT.md`; the core primitives are documented in
[`docs/core-primitives.md`](docs/core-primitives.md).

- **Language/runtime:** Python 3.12. The `framework/` package is **import-only**
  (on `sys.path`, never `pip install`ed); `pipelines/` holds runnable scripts.
  Packaging/installing the framework is an **explicit non-goal**.
- **Layout:** `framework/` (reusable engine, organised into the four public
  facade sub-packages `framework/core` (the base vocabulary — `Dataset`, plus
  the declared-schema contract: the `validate(dataset)` checks, `SchemaValidator`,
  and the value rules — which everything else builds on; the medallion `Layer`
  enum was **removed** here, and where a feed lands — the opaque
  `namespace` → file `Store` / `StoreRegistry` and the raw/silver/gold medallion
  profile over it — is application infrastructure in the sibling `tools` package
  (`tools.store`, `tools.medallion`), not framework vocabulary), `framework/io`
  (just the `Reader` / `Writer` ports and load strategies now), `framework/transform` (reshaping,
  incl. `SchemaCoercion`), and `framework/run` (composing/executing/observing a
  run; its `freshness` module holds the **one** upstream-freshness rule, which
  the runner's `FreshnessGuard` wraps and `tools.orchestration`'s plan preview
  reads); plus the private
  `framework/_internal` (`connection`, `describe`, `schema`: cross-cutting
  helpers with no public name)). The `python -m cli` entry point (`scaffold`
  plus the operator commands, `schema diff`, and `migrations make` / `migrate`;
  see below) lives in the
  top-level `cli/` package,
  and the cross-cutting `retry` / `calendar` / `medallion` / `recipes` /
  `environments` / `schema` / `migrations` / orchestration /
  observability utilities in the top-level `tools/` package — both siblings of
  `framework/`,
  not facades. The run-record schema is declared **once, as data**, in
  `tools/observability/record_schema.py` (`RUN_RECORD_FIELDS`): the JSONL record,
  the registry's DDL, its additive column migration, the `INSERT`, the row decode
  and the console line are all derived from that one ordered list, so adding a
  field is one entry — and its order is a live on-disk format, so append,
  never reorder. Where a base directory's *run metadata* lands (`_runs/`,
  `_registry/runs.db`, `_orchestration/runs.db`) is owned by `RunStore` in
  `tools/observability/run_store.py` — the counterpart of `tools.store`'s
  `StoreRegistry`, which owns where the *data* lands — and the UTC-instant /
  local-calendar-date rule every freshness check reads is settled once in
  `tools/observability/timestamps.py`. A feed's **declared table shapes** are
  the storage-side sibling of that: `tools/schema/` holds the `Table` /
  `Column` / `Index` vocabulary and the live-vs-declared diff, each feed lists
  the tables it *writes* in a `TABLES` tuple in its `schema.py`, and
  `tests/integration/test_declared_tables_match_pipelines.py` holds those
  declarations to what the pipelines actually land (see
  [`docs/schema-declaration.md`](docs/schema-declaration.md) — the framework
  itself never learns what a declaration is). Getting a real database *to*
  that declared shape is a separate, additive step: `migrations/` is a
  repo-wide tree of reviewed, forward-only `.sql` files where directory path
  is scope and filename is a globally ordered version + slug (no manifest);
  `tools/migrations/` discovers/validates the tree and resolves a base
  directory to its **medallion** databases, the one way this repo supports —
  one `<subject>/<layer>.db` per subject/layer actually present, plus the
  fixed `platform/registry` database — applying each database's pending
  migrations with its own `schema_migrations` ledger, one transaction the
  **runner** owns per file (so a migration containing its own `BEGIN`/`COMMIT`
  is refused); `tools/schema/emit.py`
  turns a `Table`'s drift into the mechanical part of the next migration,
  diffing against the tree's own tracked shape rather than any live
  environment — read by *applying* that scope's committed files to a throwaway
  in-memory database, so SQLite (never a regex) is the parser and a
  hand-edited file is reflected exactly. A coarser layout (one database per
  generic layer, or one single warehouse) was designed and prototyped, then
  removed rather than shipped broken: it collapses raw and silver into one
  file, and this repo names a silver table after the raw table it refines, so
  they collide on every feed, and fixing that needs a table-naming rule this
  repo doesn't have. A genuine collision within one database still fails
  loudly and completely, never a partial apply. See
  [`docs/migrations.md`](docs/migrations.md) — the framework itself never
  learns what a migration is, same as a declaration. Then `case_review/` (the
  case-review *application* — domain types
  like `CaseType`/`CasePool` and its gold helpers, which live outside the
  framework), `pipelines/` (scripts), `tests/` (pytest, with author test helpers
  in `tests/framework_testing/`), `docs/` (architecture, ADRs).
- **Test layout:** `tests/` mirrors the source shape — `tests/framework/`
  (itself split into `core/`, `io/`, `transform/`, `run/`,
  `_internal/`, `_cli/`, `testing/` to mirror the framework
  sub-packages and the `cli/` entry point; an
  implementation file covered by several test files gets a `test_<impl>/`
  package, e.g. `tests/framework/io/test_readers/`), `tests/case_review/`,
  `tests/pipelines/`, plus `tests/integration/` for tests that span trees (e.g.
  the public-API and framework/domain boundary tests).
  Shared helpers (`tests/_schema_fixtures.py`, `tests/fixtures/`) sit at the
  `tests/` root. Each test dir is a package (`__init__.py`) so module paths are
  unique under pytest's default import mode — no basename collisions. This is
  enforced by convention, not tooling, and had drifted: five `tests/` dirs and
  the three `tools/` package dirs were missing `__init__.py`, with a real
  basename collision present. All have since been added — every `tests/` and
  `tools/` directory is a regular package, and no two test files share a
  basename without distinct package paths. A
  scaffolded feed follows the same convention: its code lands in
  `pipelines/<feed>/` and its test in `tests/pipelines/test_<feed>.py`.
- **Public API:** application code (`pipelines/` + the `case_review/`
  domain layer) imports through the four facades `framework.core` /
  `framework.io` / `framework.transform` / `framework.run`, not the modules
  behind them (those are internal layout); the cross-cutting `tools.*` helpers
  (`tools.retry` / `tools.calendar` / `tools.orchestration` /
  `tools.observability` / `tools.environments` / `tools.recipes` /
  `tools.schema` / `tools.migrations`) are a sibling
  utility package, not a facade.
  The facades are the stable contract;
  [`docs/public-api.md`](docs/public-api.md) lists the surface, the internal
  modules, and the packaging non-goal. `tests/integration/test_public_api.py`
  holds both `pipelines/` and `case_review/` to this boundary — it
  rejects reaching *behind* a facade (`framework.core.value_rules`) as well as
  naming a non-facade module (`framework._internal.schema`), and self-tests the
  check so it cannot quietly stop guarding anything.
- **Core primitives:** `Dataset` (opaque tabular carrier, pandas behind the
  seam), `Reader` (`read() -> Dataset`; `CsvReader`, `SqliteReader`),
  `Writer` (`write(dataset) -> None`; owns target location and carries the load
  strategy; each **strategy realises its own Writer** via
  `writer_for(db_path, table, busy_timeout_ms=...)` plus the optional file-side
  `apply_to_frame(frame, read_existing)`, so nothing outside
  `framework/io/strategy.py` branches on which strategy it was handed and a new
  strategy is one class plus one export line; a table's *existence* is a
  Migration's job, not a Writer's — `Refresh` truncates (`DELETE FROM` +
  insert, in one transaction) rather than dropping and recreating, and every
  Writer (`Refresh`/the merge strategies unconditionally since #323;
  `AccumulateByRun`, `QuarantineWriter`, `InsertIfAbsent`, and the streaming
  append path behind a rollout guard since #324) raises `MissingTableError`
  naming the `python -m cli migrate` fix instead of minting a target no
  migration declared, landing rows through a shared batched-insert helper
  (`_rows_per_statement`, sized off SQLite's own placeholder limit) that is
  structurally incapable of creating one. The guard
  (`framework.io.writers.set_require_declared_tables`/
  `require_declared_tables_enabled`, a process-wide flag — never threaded
  through `Store`/`strategy.writer_for`, since a Writer holds only a database
  path and `framework/` must not import `tools.environments`) is flipped by
  `tools.environments.base_dir_for` to match the active environment's own
  `require_declared_tables` — including when an explicit `--base-dir` overrides
  that environment's root — on in `dev`, off elsewhere until that
  environment's `schema diff` is clean — see
  [ADR 0016](docs/adr/0016-migrations-own-table-structure.md). A feed's
  quarantine table (`tools.schema.quarantine_table`) is declared and migrated
  the same way, under a `quarantine` scope alongside `raw`/`silver`/`gold`.
  `scaffold` declares a feed's `TABLES` and generates its first migrations, so
  `migrate` then `run` both work before a line is edited), `Store` (namespace → file
  factory minting `writer(table, strategy)` — a one-line delegation to
  `strategy.writer_for(...)` — / `reader(table)` over one logical database; **lives in the sibling
  `tools.store`, not `framework.io`** — where a feed lands is application
  infrastructure, not framework vocabulary.
  `StoreRegistry` mints namespace stores via `store(namespace)` **and** registers
  named Readers/Writers — `register(name, reader|writer)` then `reader(name)` /
  `writer(name)` — so a pipeline refers to a component by name; the raw/silver/gold
  medallion is the `tools.medallion` profile over it, `<subject>/{raw,silver,gold}.db`;
  `connect` factory in `framework._internal.connection`), `Pipeline` (deferred DAG
  builder; nodes wired by `.read` / `.transform` /
  `.validate` / `.write`; at `.run()` the graph is walked from its leaves, each
  node executing after its inputs — a graph where *every* node is an input to
  another leaves that walk no starting point, and raises `PipelineGraphError`
  rather than silently executing nothing. A node **returns** a `StepResult` (its
  dataset, the metrics only it could know, whether it committed) and never
  records: the wrapper writes **exactly one** run-log record per node execution,
  so recording lives in one place. `.read_chunks(chunk_reader, name=...,
  chunk_size=...)` is the **streaming** read: the sub-graph *below* that
  node is driven once per bounded chunk, so a source too big to hold whole keeps
  the validators/quarantine/dry-run/profiling/addresses, while the per-chunk
  records are folded into one summed record per step and every Writer below the
  source spends the drive inside one `ChunkWritable.writing_chunks()` session.
  Pairings that cannot be made chunk-safe are refused **at wiring time** with a
  `PipelineGraphError` naming the component: a target-replacing Writer
  (`Refresh`, the file Writers), a `whole_dataset` Validator (`UniqueValidator`,
  `VolumeAnomalyValidator` — `StreamingUniqueValidator` is the surviving form),
  `explain` (its trace holds every row), and a second streamed source).

### Commands

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt   # pandas + pytest + ruff + pre-commit
.venv/bin/pre-commit install                      # activate the lint/format git hooks (once per clone)
.venv/bin/python -m pytest                       # run the suite
.venv/bin/python -m pipelines.demo_csv_to_raw /tmp/demo   # run the demo (module form, from repo root)
.venv/bin/python -m cli scaffold orders            # scaffold a feed -> pipelines/orders/ + tests/pipelines/test_orders.py
.venv/bin/python -m cli scaffold orders --from-feed-file sample.csv  # seed schema/sample/test from a real CSV header
.venv/bin/python -m cli scaffold --case-type claims # scaffold a Case Type ingest feed (source->raw->silver, identity declared)
.venv/bin/python -m cli run pipelines/ingest --base-dir /tmp/demo  # operator CLI: run/orchestrate/status/runs/log (see docs/operator-cli.md)
.venv/bin/python -m cli schema diff --base-dir /tmp/demo         # diff every feed's declared TABLES against a live environment (see docs/schema-declaration.md)
.venv/bin/python -m cli migrations make            # emit the next migration file for every drifted declared table
.venv/bin/python -m cli migrate --env dev --plan   # preview pending migrations for an environment's base dir (see docs/migrations.md)
.venv/bin/pre-commit run --all-files             # lint + format the whole tree on demand
```

**Lint/format/test:** `ruff` is the linter and formatter (config in
`pyproject.toml`). The `.pre-commit-config.yaml` hooks run `ruff check --fix` then
`ruff format` on staged files at commit time once `pre-commit install` has been
run; a commit is blocked if `ruff check` reports an unfixable error (e.g. an
unused variable or an over-long line), so fix it and re-stage. The hooks read the
same `pyproject.toml` config, so they match a local `ruff` invocation. A third
hook runs the **full `pytest` suite** whenever any Python file is staged (a
`language: system` local hook, so it uses the active environment — activate the
venv before committing); a failing test blocks the commit.

Run pipelines as **modules from the repo root** (`python -m pipelines.<name>`)
so the import-only `framework` package resolves on `sys.path`. The framework
itself is also runnable — `python -m cli <command>` (entry point in the
top-level `cli/`) is the single surface for authoring (`scaffold`), operating
(`run`/`orchestrate`/`status`/`runs`/`log`), and declared-table drift
(`schema diff`; see [`docs/schema-declaration.md`](docs/schema-declaration.md))
over pipelines. `run` addresses a pipeline
by **its location on disk** — `python -m cli run pipelines/<name>` imports
`pipelines.<name>.pipeline` and executes its `run(context)` callable (reading an
optional `UPSTREAMS` freshness tuple), so the dependency stays one-way and the
framework never statically depends on `pipelines/`. `orchestrate` addresses
pipelines the **same** way — each `ScheduledPipeline` names a `pipelines/<name>`
path, run at its scheduled time by the same rule (no handler registry) — and
takes a required `--app` naming an application's schedules module that exposes
`build_pipeline_sets()`.

Scaffold a new feed with `python -m cli scaffold <feed>`: it renders the
feed code as a `pipelines/<feed>/` subpackage (schema, pipeline, sample fixture)
and its test as `tests/pipelines/test_<feed>.py`, from the template under
`cli/scaffold_templates/feed/`, ready to run and customise. The
generic feed refines source -> raw -> silver -> gold, one `*_builder` per hop
(`raw_builder` lands faithfully; `silver_builder` renames via `RENAME` + coerces + quarantines +
validates the schema; `gold_builder` is a passthrough stub with a `TODO`) — the
first two **compose the shared hop recipes** in `tools.recipes`
(`source_to_raw` / `raw_to_silver`) rather than carrying a copy of the
standard hop, so a change to the standard reaches every feed that composes it;
a feed that must diverge inlines the recipe's body into its own builder — wired
in order by `run(context, *, describe=False)` and an argparse `main`. Pass
`--from-feed-file <path>` to seed the scaffold from a real sample CSV: the header
becomes the schema's fields (canonicalised to identifiers, dtypes inferred from
the first rows, capped at 40 columns), the file's contents replace the bundled
sample, and the test's sample rows are taken from it; when a header name isn't a
clean identifier (spaces/punctuation/capitals) the source names are emitted as a
`RAW_FEED_COLUMNS` constant the raw `ColumnValidator` gates on and the
`silver_builder`'s `RENAME` map is populated to canonicalise them (raw stays
faithful; silver renames to the schema's canonical shape). Add `--case-type`
for the Case Type ingest variant: a case-review-flavoured slice from
`cli/scaffold_templates/case_type/` that additionally declares the Case
Type's identity contract (`case_type.py`) and refines source → raw → silver,
**stopping at silver** — how silver is assembled into gold is per-Case-Type and
an open decision (snapshot-vs-join), so it's left as a commented seam. See
[`docs/adding-a-feed.md`](docs/adding-a-feed.md).

## Core constraint: cross-platform (Windows-first, macOS-compatible)

The framework's primary deployment target is **Windows**, but it must also run on **macOS** (the main development environment here — see git config and `darwin` platform). Treat this as a hard requirement that affects most design decisions:

- Use OS-agnostic path handling everywhere; never hardcode path separators or drive-letter / POSIX assumptions.
- Avoid shelling out to platform-specific commands without a cross-platform fallback.
- Be mindful of line endings (CRLF vs LF), case-sensitivity differences (Windows is case-insensitive, macOS default is case-insensitive but can be sensitive), and file-locking semantics, which differ between the two.
- Prefer dependencies and runtimes that are first-class on both platforms.

## Working in this repo

The framework's language, runtime, and tooling have not been chosen yet. Before scaffolding anything substantial, confirm those decisions with the user rather than assuming — they have indicated the details will be defined collaboratively ("We'll dive into the details next").

**Keep the docs in sync with every change.** Any piece of work — a new primitive, a renamed term, a behaviour change — is not done until the affected documentation reflects it: the relevant per-slice doc under `docs/`, the usage guide [`docs/README.md`](docs/README.md), the domain language in [`CONTEXT.md`](CONTEXT.md), and any ADR it touches. Treat stale docs as a defect in the change itself, not a follow-up.
