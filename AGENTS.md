# AGENTS.md

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
  (just the `Reader` / `Writer` ports and load strategies now),
  `framework/transform` (reshaping, incl. `SchemaCoercion`), and `framework/run`
  (composing/executing/observing a run; its `freshness` module holds the **one**
  upstream-freshness rule, which the runner's `FreshnessGuard` wraps and
  `tools.orchestration`'s plan preview reads); plus the private
  `framework/_internal` (`connection`, `describe`, `locations`, `schema`: cross-cutting
  helpers with no public name)). The `python -m cli` entry point (`scaffold`
  plus the operator commands; see below) lives in the top-level `cli/` package,
  and the cross-cutting `retry` / `calendar` / `medallion` /
  `deliverables` /
  `environments` / orchestration / observability utilities in the top-level
  `tools/` package — both siblings of `framework/`, not facades. `shared/`
  contains application-wide declarations such as environment roots, kept
  separate from the resolver in `tools/` so other application code can reuse
  the constants without importing operational behaviour. The run-record
  schema is declared **once, as data**, in
  `tools/observability/record_schema.py` (`RUN_RECORD_FIELDS`): the JSONL record,
  the registry's DDL, its additive column migration, the `INSERT`, the row decode
  and the console line are all derived from that one ordered list, so adding a
  field is one entry — and its order is a live on-disk format, so append,
  never reorder. Where a base directory's *run metadata* lands (`_runs/`,
  `_registry/runs.db`, `_orchestration/runs.db`) is owned by `RunStore` in
  `tools/observability/run_store.py` — the counterpart of `tools.store`'s
  `StoreRegistry`, which owns where the *data* lands — and the UTC-instant /
  local-calendar-date rule every freshness check reads is settled once in
  `tools/observability/timestamps.py`. Then `case_review/` (the
  case-review *application* — Case Type declarations, `CasePool`, and its gold
  helpers, which live outside the framework; it also owns the application's
  orchestration schedules, `case_review/schedules.py`, which `orchestrate --app`
  names), `pipelines/` (scripts),
  `tests/` (pytest, with author test helpers in `tests/framework_testing/`),
  `docs/` (architecture, ADRs).
- **Test layout:** `tests/` mirrors the source shape — `tests/framework/`
  (itself split into `core/`, `io/`, `transform/`, `run/`, `_internal/`,
  `_cli/`, `testing/` to mirror the framework sub-packages and the `cli/` entry
  point; an implementation file covered by several test files gets a
  `test_<impl>/` package, e.g. `tests/framework/io/test_readers/`),
  `tests/case_review/`, `tests/pipelines/`, `tests/tools/`, `tests/shared/`,
  `tests/scripts/`,
  plus `tests/integration/` for tests that span trees (e.g. the public-API and
  framework/domain boundary tests).
  Shared helpers (`tests/_schema_fixtures.py`, `tests/fixtures/`) sit at the
  `tests/` root. Each test dir is a package (`__init__.py`) so module paths are
  unique under pytest's default import mode — no basename collisions. This is
  enforced by convention, not tooling, and had drifted until the missing
  `__init__.py` files were added: every `tests/` and `tools/` directory is now a
  regular package. A scaffolded feed follows the same convention: its code
  lands in `pipelines/<feed>/` and its test in
  `tests/pipelines/test_<feed>.py`.
- **Public API:** application code (`pipelines/` + the `case_review/`
  domain layer) imports through the four facades `framework.core` /
  `framework.io` / `framework.transform` / `framework.run`, not the modules
  behind them (those are internal layout); the cross-cutting `tools.*` helpers
  (`tools.retry` / `tools.calendar` / `tools.orchestration` /
  `tools.observability` / `tools.environments` /
  `tools.deliverables`) are a sibling
  utility package, not a facade. The facades are the stable contract;
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
  strategy is one class plus one export line), `Store` (namespace → file
  factory minting `writer(table, strategy)` — a one-line delegation to
  `strategy.writer_for(...)` — / `reader(table)` over one logical database;
  **lives in the sibling `tools.store`, not `framework.io`** — where a feed
  lands is application infrastructure, not framework vocabulary.
  `StoreRegistry` mints namespace stores via `store(namespace)` **and** registers
  named Readers/Writers — `register(name, reader|writer)` then `reader(name)` /
  `writer(name)` — so a pipeline refers to a component by name; the raw/silver/gold
  medallion is the `tools.medallion` profile over it, `<subject>/{raw,silver,gold}.db`;
  `connect` factory in `framework._internal.connection`), `Pipeline` (deferred
  DAG builder; nodes wired by `.read` / `.transform` /
  `.validate` / `.write`; at `.run()` the graph is walked from its leaves, each
  node executing after its inputs — a graph where *every* node is an input to
  another leaves that walk no starting point, and raises `PipelineGraphError`
  rather than silently executing nothing).

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
top-level `cli/`) is the single surface for authoring (`scaffold`) and operating
(`run`/`orchestrate`/`status`/`runs`/`log`) pipelines. `run` addresses a pipeline
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
generic feed refines source -> raw -> silver -> gold, one `to_*` function per step
(`to_raw` lands faithfully; `to_silver` renames via `RENAME` then `enforce`s the
schema — coerce, quarantine, validate, in that order; `to_gold` is a passthrough
stub with a `TODO`). Each is written with the **eager steps**, so every line
does its work when it is reached and can be stepped through in a debugger
([ADR-0027](docs/adr/0027-eager-steps-are-the-default-authoring-model.md)) — four
or so readable lines you edit in place — wired
in order by `run(context)` and an argparse `main` that routes through the same
`run_pipeline` the operator CLI uses, so both entry points record one identity. Pass
`--from-feed-file <path>` to seed the scaffold from a real sample CSV: the header
becomes the schema's fields (canonicalised to identifiers, dtypes inferred from
the first rows, capped at 40 columns), the file's contents replace the bundled
sample, and the test's sample rows are taken from it; when a header name isn't a
clean identifier (spaces/punctuation/capitals) the source names are emitted as a
`RAW_FEED_COLUMNS` constant the raw `ColumnValidator` gates on and the
`to_silver`'s `RENAME` map is populated to canonicalise them (raw stays
faithful; silver renames to the schema's canonical shape). Add `--case-type`
for the Case Type ingest variant: a case-review-flavoured slice from
`cli/scaffold_templates/case_type/` that additionally declares the Case
Type's `NAMESPACE` and `NATURAL_KEY` beside its row schema and refines source → raw → silver,
**stopping at silver** — how silver is assembled into gold is per-Case-Type and
an open decision (snapshot-vs-join), so it's left as a commented seam. See
[`docs/adding-a-feed.md`](docs/adding-a-feed.md).

## GitHub ticket labels

When creating a GitHub issue, labelling is part of creating the ticket, not a
later triage task. Inspect the repository's current labels first, then apply all
four independent classifications below:

- **Size — exactly one:** `size: S`, `size: M`, or `size: L`. Use `S` for a
  localised change with a narrow test/doc surface, `M` for work spanning several
  files or layers, and `L` for a cross-cutting change, migration, or substantial
  design seam. Split work that is materially larger than `L` rather than hiding
  it behind a new oversized estimate.
- **Priority — exactly one:** `priority: low`, `priority: medium`, or
  `priority: high`, based on urgency and impact rather than implementation size.
- **Execution mode — exactly one:** `AFK` when an agent can implement and verify
  the ticket from repository context and normal tooling without waiting for a
  person; `HITL` when progress needs a product/domain decision, live-environment
  evidence or access, credentials, external coordination, or manual approval.
  Supplemental labels such as `needs-product-decision` or `ready-for-agent` do
  not replace this choice.
- **Area — one or more:** apply every relevant available `area: ...` label. The
  current taxonomy includes `area: data-contract`, `area: question-bank`,
  `area: remediation`, `area: rendering`, `area: reporting`, and
  `area: sharepoint-adapter`; do not force a ticket into only one area when it
  genuinely crosses boundaries.

Reuse the exact existing label whenever it fits. If the current labels do not
cover a genuinely needed classification, create a new label following the
existing naming convention (for example `area: orchestration`) with a concise
description and a colour consistent with the taxonomy; do not silently omit the
classification or create a near-duplicate spelling. After creating the issue,
read it back and verify the size, priority, execution-mode, and area labels were
all applied. The template's `needs-triage` label is additive and does not satisfy
any of these four axes.

## Core constraint: cross-platform (Windows-first, macOS-compatible)

The framework's primary deployment target is **Windows**, but it must also run on **macOS** (the main development environment here — see git config and `darwin` platform). Treat this as a hard requirement that affects most design decisions:

- Use OS-agnostic path handling everywhere; never hardcode path separators or drive-letter / POSIX assumptions.
- Avoid shelling out to platform-specific commands without a cross-platform fallback.
- Be mindful of line endings (CRLF vs LF), case-sensitivity differences (Windows is case-insensitive, macOS default is case-insensitive but can be sensitive), and file-locking semantics, which differ between the two.
- Prefer dependencies and runtimes that are first-class on both platforms.

## Working in this repo

The framework's language, runtime, and tooling have not been chosen yet. Before scaffolding anything substantial, confirm those decisions with the user rather than assuming — they have indicated the details will be defined collaboratively ("We'll dive into the details next").

**Keep the docs in sync with every change.** Any piece of work — a new primitive, a renamed term, a behaviour change — is not done until the affected documentation reflects it: the relevant per-slice doc under `docs/`, the usage guide [`docs/README.md`](docs/README.md), the domain language in [`CONTEXT.md`](CONTEXT.md), and any ADR it touches. Treat stale docs as a defect in the change itself, not a follow-up.

- Always activate the virtual environment (`. .venv/bin/activate`) before running `git commit` to ensure pre-commit hooks run in the correct environment with all dependencies. Never use `--no-verify` to bypass hooks unless explicitly instructed.
