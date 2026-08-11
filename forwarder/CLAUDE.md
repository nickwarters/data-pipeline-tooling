# Forwarder project guidance

The Forwarder is a separate top-level project. This slice contains only its
package/test shell and local documentation; no delivery runtime exists yet.
The Forwarder imports nothing from `framework/`.

## Layout

- `forwarder/` is the importable package.
- `forwarder/tests/` contains the Forwarder's pytest suite.
- `forwarder/CONTEXT.md` is the local glossary.
- `forwarder/docs/adr/` contains Forwarder-specific decision records.

The local ADR and glossary own Forwarder terms and decisions. Root delivery
terms remain in [`../CONTEXT.md`](../CONTEXT.md), and the project index is in
[`../docs/README.md`](../docs/README.md).

## Checks

Run these commands from the repository root after activating the virtual
environment:

```sh
python -m pytest forwarder/tests -q
python -m ruff check forwarder
python -m ruff format --check forwarder
```

On Windows, use the same module commands after activating `.venv`; do not
assume POSIX path separators or `.venv/bin` exists. Use `pathlib` for any
future filesystem work and keep paths relative to explicit configuration.

The Forwarder pytest pre-commit hook is scoped to `forwarder/`. The root
pytest hook excludes this project, so a Forwarder Python change runs the local
suite rather than the pipeline suite.
