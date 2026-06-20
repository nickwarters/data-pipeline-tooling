```python
"""Make the framework runnable: ``python -m cli <command> ...``.

Thin entry point that defers to the unified CLI in :mod:`cli`. Run
from the repository root so the import-only ``framework`` package resolves.
"""

from cli import main

if __name__ == "__main__":  # pragma: no cover - thin CLI entry
    raise SystemExit(main())

```
