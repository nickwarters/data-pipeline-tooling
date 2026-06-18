"""Make the framework runnable: ``python -m framework <command> ...``.

Thin entry point that defers to the unified CLI in :mod:`framework._cli`. Run
from the repository root so the import-only ``framework`` package resolves.
"""

from framework._cli import main

if __name__ == "__main__":  # pragma: no cover - thin CLI entry
    raise SystemExit(main())
