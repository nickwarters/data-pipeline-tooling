# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

The **walking skeleton** is in place (issue #2): the CSV → raw path through the
core primitives. Architecture is governed by the ADRs in `docs/adr/` and the
domain language in `CONTEXT.md`; the core primitives are documented in
[`docs/core-primitives.md`](docs/core-primitives.md).

- **Language/runtime:** Python 3.12. The `framework/` package is **import-only**
  (on `sys.path`, never `pip install`ed); `pipelines/` holds runnable scripts.
- **Layout:** `framework/` (engine + domain), `pipelines/` (scripts),
  `tests/` (pytest), `docs/` (architecture, ADRs).
- **Core primitives (locked by #2):** `DataHandle` (opaque tabular carrier,
  pandas behind the seam), `Reader` (`read() -> DataHandle`), `Store` (dumb
  SQLite medallion store + connection factory), `Pipeline` (deferred fluent
  builder; runs only at `.to(layer)`).

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
