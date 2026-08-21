```python
"""Build paths in a pipeline's local deliverable outbox."""

from __future__ import annotations

import os
from pathlib import Path, PureWindowsPath

REPORT_FEEDS_DESTINATION = "cora_report_feeds"
NOTIFICATIONS_DESTINATION = "cora_notifications"

__all__ = [
    "REPORT_FEEDS_DESTINATION",
    "NOTIFICATIONS_DESTINATION",
    "get_deliverable_root",
    "get_deliverable_path",
]


def get_deliverable_root(base_dir: str | os.PathLike[str]) -> Path:
    """Return the root of the deliverable outbox under ``base_dir``."""
    return Path(base_dir) / "deliverables"


def get_deliverable_path(
    base_dir: str | os.PathLike[str],
    destination: str | os.PathLike[str],
    *parts: str | os.PathLike[str],
) -> Path:
    """Return a path below one destination in the deliverable outbox."""
    path = get_deliverable_root(base_dir) / _validated_relative(
        destination, "destination"
    )
    for index, part in enumerate(parts, start=1):
        path /= _validated_relative(part, f"sub-path part {index}")
    return path


def _validated_relative(value: str | os.PathLike[str], label: str) -> Path:
    raw = os.fspath(value)
    windows_path = PureWindowsPath(raw)

    if windows_path.drive or windows_path.root:
        raise ValueError(f"{label} must be a relative path, got {raw!r}")

    if ".." in windows_path.parts:
        raise ValueError(f"{label} must not contain '..' path traversal: {raw!r}")

    if not windows_path.parts:
        raise ValueError(f"{label} must not be empty or '.': {raw!r}")

    # Parse both slash styles as separators, then rebuild with the host's
    # native Path implementation so the same input has the same meaning on
    # Windows and macOS.
    return Path(*windows_path.parts)

```
