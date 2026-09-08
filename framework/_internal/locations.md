```python
"""How a component names the data it touched: a ``namespace`` and a ``name``,
the shape OpenLineage uses for dataset identity."""

from __future__ import annotations

import os
from pathlib import Path


def file_location(path: str | os.PathLike[str]) -> dict[str, str]:
    """The location of a local file, named as it was given.

    Not resolved: ``resolve()`` touches the filesystem and rewrites symlinks, so
    the record would name something other than what the caller configured and
    what ``describe()`` renders.
    """
    return {"namespace": "file", "name": str(Path(path))}


def table_location(db_path: str | os.PathLike[str], table: str) -> dict[str, str]:
    """One table in a SQLite database, the path rendered POSIX-style so a record
    written on Windows is comparable with one written on macOS."""
    return {"namespace": f"sqlite:{Path(db_path).as_posix()}", "name": table}

```
