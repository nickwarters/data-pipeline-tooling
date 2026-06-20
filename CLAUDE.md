# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

The **walking skeleton** is in place (issue #2): the CSV → raw path through the
core primitives. Architecture is governed by the ADRs in `docs/adr/` and the
domain language in `CONTEXT.md`; the core primitives are documented in
[`docs/core-primitives.md`](docs/core-primitives.md).

- **Language/runtime:** Python 3.12. The `framework/` package is **import-only**
  (on `sys.path`, never `pip install`ed); `pipelines/` holds runnable scripts.
  Packaging/installing the framework is an **explicit non-goal** (#95).
- **Layout:** `framework/` (reusable engine, organised into the six public
  facade sub-packages `framework/core` (the base vocabulary — `Dataset` + the
  medallion `Layer` constants, which everything else builds on), `framework/io`,
  `framework/transform` (reshaping, incl. `SchemaCoercion`), `framework/validate`
  (the `validate(dataset)` checks + the declared-schema contract —
  `SchemaValidator` and the value rules), `framework/run`, and `framework/shared`
  (cross-cutting utilities — `retry`, `calendar`); plus three non-facade
  packages — the private `framework/_internal` (`connection`, `describe`,
  `schema`: cross-cutting helpers with no public name), the private
  `framework/_cli` (the `python -m cli` entry point — `scaffold` plus the
  operator commands; see below), and the test-only
  `framework/testing`), `case_review/` (the case-review *application* — domain
  types like `CaseType`/`CasePool` and its gold helpers, which live outside the
  framework), `pipelines/` (scripts), `tests/` (pytest), `docs/` (architecture,
  ADRs).
- **Test layout:** `tests/` mirrors the source shape — `tests/framework/`
  (itself split into `core/`, `io/`, `transform/`, `validate/`, `run/`,
  `shared/`, `_internal/`, `_cli/`, `testing/` to mirror the framework
  sub-packages; an
  implementation file covered by several test files gets a `test_<impl>/`
  package, e.g. `tests/framework/io/test_readers/`), `tests/case_review/`,
  `tests/pipelines/`, plus `tests/integration/` for tests that span trees (e.g.
  the public-API and framework/domain boundary tests).
  Shared helpers (`tests/_schema_fixtures.py`, `tests/fixtures/`) sit at the
  `tests/` root. Each test dir is a package (`__init__.py`) so module paths are
  unique under pytest's default import mode — no basename collisions. A
  scaffolded feed (#97) follows the same convention: its code lands in
  `pipelines/<feed>/` and its test in `tests/pipelines/test_<feed>.py`.
- **Public API (#95):** application code (`pipelines/` + the `case_review/`
  domain layer) imports through the six facades `framework.core` /
  `framework.io` / `framework.transform` / `framework.validate` /
  `framework.run` / `framework.shared`, not the modules behind them (those are
  internal layout).
  The facades are the stable contract;
  [`docs/public-api.md`](docs/public-api.md) lists the surface, the internal
  modules, and the packaging non-goal. `tests/integration/test_public_api.py`
  holds both `pipelines/` and `case_review/` to this boundary.
- **Core primitives:** `Dataset` (opaque tabular carrier, pandas behind the
  seam), `Reader` (`read() -> Dataset`; `CsvReader`, `SqliteReader`),
  `Writer` (`write(dataset) -> None`; owns target location + load strategy —
  added by #14), `Store` (per-subject medallion that mints the layer's
  Writers/Readers over `<subject>/{raw,silver,gold}.db` — #15; `connect` factory
  now in `framework._internal.connection`), `Pipeline` (deferred fluent builder;
  `.write_to(writer)` composes, `.run()` executes — replaced `.to(layer)` in
  #14).

### Commands

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt   # pandas + pytest
.venv/bin/python -m pytest                       # run the suite
.venv/bin/python -m pipelines.demo_csv_to_raw /tmp/demo   # run the demo (module form, from repo root)
.venv/bin/python -m cli scaffold orders            # scaffold a feed -> pipelines/orders/ + tests/pipelines/test_orders.py (#97)
.venv/bin/python -m cli scaffold orders --from-feed-file sample.csv  # seed schema/sample/test from a real CSV header
.venv/bin/python -m cli scaffold --case-type claims # scaffold a Case Type ingest feed (source->raw->silver, identity declared; #155)
.venv/bin/python -m cli run pipelines/ingest /tmp/demo            # operator CLI: run/orchestrate/status/runs/log (see docs/operator-cli.md)
```

Run pipelines as **modules from the repo root** (`python -m pipelines.<name>`)
so the import-only `framework` package resolves on `sys.path`. The framework
itself is also runnable — `python -m cli <command>` (entry point in
`framework/_cli`) is the single surface for authoring (`scaffold`) and operating
(`run`/`orchestrate`/`status`/`runs`/`log`) pipelines. `run` addresses a pipeline
by **its location on disk** — `python -m cli run pipelines/<name>` imports
`pipelines.<name>.pipeline` and executes its `run(context)` callable (reading an
optional `UPSTREAMS` freshness tuple), so the dependency stays one-way and the
framework never statically depends on `pipelines/`. Only `orchestrate` still
takes a required `--app` naming an application's registry module that exposes
`build_runner()` / `build_pipeline_sets()`.

Scaffold a new feed with `python -m cli scaffold <feed>`: it renders the
feed code as a `pipelines/<feed>/` subpackage (schema, pipeline, sample fixture)
and its test as `tests/pipelines/test_<feed>.py`, from the template under
`framework/_cli/scaffold_templates/feed/`, ready to run and customise. The
generic feed refines source -> raw -> silver -> gold, one `*_builder` per hop
(`raw_builder` lands faithfully; `silver_builder` renames via `RENAME` + coerces +
validates the schema; `gold_builder` is a passthrough stub with a `TODO`), wired
in order by `run(context, *, describe=False)` and an argparse `main`. Pass
`--from-feed-file <path>` to seed the scaffold from a real sample CSV: the header
becomes the schema's fields (canonicalised to identifiers, dtypes inferred from
the first rows, capped at 40 columns), the file's contents replace the bundled
sample, and the test's sample rows are taken from it; when a header name isn't a
clean identifier (spaces/punctuation/capitals) the source names are emitted as a
`RAW_FEED_COLUMNS` constant the raw `ColumnValidator` gates on and the
`silver_builder`'s `RENAME` map is populated to canonicalise them (raw stays
faithful; silver renames to the schema's canonical shape). Add `--case-type`
for the Case Type ingest variant (#155): a case-review-flavoured slice from
`framework/_cli/scaffold_templates/case_type/` that additionally declares the Case
Type's identity contract (`case_type.py`) and refines source → raw → silver,
**stopping at silver** — how silver is assembled into gold is per-Case-Type and
an open decision (snapshot-vs-join — #163), so it's left as a commented seam. See
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
