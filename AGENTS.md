# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

The **walking skeleton** is in place (issue #2): the CSV → raw path through the
core primitives. Architecture is governed by the ADRs in `docs/adr/` and the
domain language in `CONTEXT.md`; the core primitives are documented in
[`docs/core-primitives.md`](docs/core-primitives.md).

- **Language/runtime:** Python 3.12. The `framework/` package is **import-only**
  (on `sys.path`, never `pip install`ed); `pipelines/` holds runnable scripts.
- **Layout:** `framework/` (reusable engine, organised into the six public
  facade sub-packages `framework/core` (the base vocabulary — `Dataset` + the
  medallion `Layer` constants), `framework/io`, `framework/transform` (reshaping,
  incl. `SchemaCoercion`), `framework/validate` (the `validate(dataset)` checks +
  the declared-schema contract — `SchemaValidator` and the value rules),
  `framework/run`, and `framework/shared` (cross-cutting utilities — `retry`,
  `calendar`); plus the private `framework/_internal` (`connection`, `describe`,
  `schema`) and the test-only `framework/testing`), `case_review/` (the
  case-review *application* — domain
  types and gold helpers that live outside the framework), `pipelines/`
  (scripts), `tests/` (pytest), `docs/` (architecture, ADRs).
- **Test layout:** `tests/` mirrors the source shape — `tests/framework/`
  (itself split into `core/`, `io/`, `transform/`, `validate/`, `run/`,
  `shared/`, `_internal/`, `testing/` to mirror the framework sub-packages; an
  implementation file covered by several test files gets a `test_<impl>/`
  package, e.g. `tests/framework/io/test_readers/`), `tests/case_review/`,
  `tests/pipelines/`, and `tests/integration/` for cross-tree tests. Shared
  helpers
  (`tests/_schema_fixtures.py`, `tests/fixtures/`) live at the `tests/` root;
  each test dir is a package.
- **Core primitives:** `Dataset` (opaque tabular carrier, pandas behind the
  seam), `Reader` (`read() -> Dataset`; `CsvReader`, `SqliteReader`),
  `Writer` (`write(dataset) -> None`; owns target location + load strategy —
  added by #14), `Store` / `StoreRegistry` (namespace → file factory minting
  Writers/Readers over one logical database; `StoreRegistry` also registers named
  Readers/Writers a pipeline fetches by name. Lives in the sibling `tools.store`,
  **not** `framework.io` — where a feed lands is application infrastructure, not
  framework vocabulary (#15/#232); the raw/silver/gold medallion is the
  `tools.medallion` profile over it, `<subject>/{raw,silver,gold}.db`; `connect`
  factory in `framework._internal.connection`), `Pipeline` (deferred DAG builder; nodes wired by `.read` / `.transform` /
  `.validate` / `.write` and executed in topological order at `.run()`).

### Commands

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt   # pandas + pytest
.venv/bin/python -m pytest                       # run the suite
.venv/bin/python -m pipelines.demo_csv_to_raw /tmp/demo   # run the demo (module form, from repo root)
```

Run pipelines as **modules from the repo root** (`python -m pipelines.<name>`)
so the import-only `framework` package resolves on `sys.path`.

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
