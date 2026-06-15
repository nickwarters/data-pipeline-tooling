# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

The **walking skeleton** is in place (issue #2): the CSV → raw path through the
core primitives. Architecture is governed by the ADRs in `docs/adr/` and the
domain language in `CONTEXT.md`; the core primitives are documented in
[`docs/core-primitives.md`](docs/core-primitives.md).

- **Language/runtime:** Python 3.12. The `framework/` package is **import-only**
  (on `sys.path`, never `pip install`ed); `pipelines/` holds runnable scripts.
- **Layout:** `framework/` (reusable engine, organised into the facade
  sub-packages `framework/io`, `framework/transform`, `framework/run`; the
  checks package `framework/validate` and the cross-cutting internal
  `framework/shared` (`connection`/`describe`/`retry`/`calendar`), both surfaced
  through the facades; and the test-support `framework/testing`), `case_review/`
  (the case-review *application* — domain types and gold helpers that live
  outside the framework), `pipelines/` (scripts), `tests/` (pytest), `docs/`
  (architecture, ADRs).
- **Test layout:** `tests/` mirrors the source shape — `tests/framework/`
  (itself split into `io/`, `transform/`, `run/`, `validate/`, `shared/`,
  `testing/` to mirror the framework sub-packages; an implementation file
  covered by several test files gets a `test_<impl>/` package, e.g.
  `tests/framework/io/test_readers/`), `tests/case_review/`, `tests/pipelines/`,
  and `tests/integration/` for cross-tree tests. Shared helpers
  (`tests/_schema_fixtures.py`, `tests/fixtures/`) live at the `tests/` root;
  each test dir is a package.
- **Core primitives:** `Dataset` (opaque tabular carrier, pandas behind the
  seam), `Reader` (`read() -> Dataset`; `CsvReader`, `SqliteReader`),
  `Writer` (`write(dataset) -> None`; owns target location + load strategy —
  added by #14), `Store` (per-subject medallion that mints the layer's
  Writers/Readers over `<subject>/{raw,silver,gold}.db` — #15; `connect` factory
  now in `framework.shared.connection`), `Pipeline` (deferred fluent builder;
  `.write_to(writer)` composes, `.run()` executes — replaced `.to(layer)` in
  #14).

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
