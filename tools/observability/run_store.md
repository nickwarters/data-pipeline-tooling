```python
"""The owner of a base directory's run-metadata layout.

A base directory holds two kinds of thing. The *data* — the medallion databases
— is laid out by ``tools.store``'s ``StoreRegistry``. The *run metadata* — the
JSONL run logs, the registry that indexes them, the orchestration decision log —
is laid out here. They are deliberately separate concerns and neither constructs
the other; this is the counterpart of ``StoreRegistry``, not an extension of it.

Every path under a base directory that is about *runs* rather than *rows* comes
from here, giving the layout one owner and preventing drift between callers.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from tools.observability.run_log import RunLog
from tools.observability.run_registry import RunRegistry

__all__ = ["RunStore"]


@dataclass(frozen=True)
class RunStore:
    """The run-metadata layout of one base directory, and the pieces it opens."""

    base_dir: Path

    def __init__(self, base_dir: str | os.PathLike[str]) -> None:
        object.__setattr__(self, "base_dir", Path(base_dir))

    @property
    def runs_dir(self) -> Path:
        """The directory the per-subject JSONL run logs are appended to."""
        return self.base_dir / "_runs"

    @property
    def registry_path(self) -> Path:
        """The SQLite file the run registry indexes those logs into."""
        return self.base_dir / "_registry" / "runs.db"

    @property
    def orchestration_path(self) -> Path:
        """The SQLite file scheduled-work decisions are recorded to."""
        return self.base_dir / "_orchestration" / "runs.db"

    def log_path_for(self, subject: str) -> Path:
        """The run-log file a subject (or a path-addressed pipeline) writes to."""
        return self.runs_dir / f"{subject}.log"

    def registry(self) -> RunRegistry:
        """Open the run registry for this base directory."""
        return RunRegistry(self.registry_path)

    def log_for(self, subject: str) -> RunLog:
        """Open the run log a subject appends its records to."""
        return RunLog(self.log_path_for(subject))

    def catch_up(self) -> RunRegistry:
        """Ingest every unread run log into the registry, and return it.

        The sweep a run or a plan does before it consults history: an upstream's
        records are visible no matter which subject's log partitioned them.
        Ingest is incremental and idempotent, so repeating it is cheap and safe.
        """
        registry = self.registry()
        if self.runs_dir.exists():
            for log_file in sorted(self.runs_dir.glob("*.log")):
                registry.ingest(log_file)
        return registry

```
