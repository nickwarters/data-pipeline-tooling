"""Build paths in a pipeline's local deliverable outbox."""

from __future__ import annotations

import os
from pathlib import Path, PurePosixPath, PureWindowsPath

REPORT_FEEDS_DESTINATION = "cora_report_feeds"

__all__ = [
    "REPORT_FEEDS_DESTINATION",
    "get_deliverable_root",
    "get_destination_root",
    "get_deliverable_path",
]


def get_deliverable_root(base_dir: str | os.PathLike[str]) -> Path:
    """Return the root of the deliverable outbox under ``base_dir``."""
    return Path(base_dir) / "deliverables"


def get_destination_root(
    base_dir: str | os.PathLike[str],
    destination: str | os.PathLike[str],
) -> Path:
    """Return one destination directory in the deliverable outbox."""
    destination_path = _validated_relative(destination, "destination", reject_dot=True)
    return get_deliverable_root(base_dir) / destination_path


def get_deliverable_path(
    base_dir: str | os.PathLike[str],
    destination: str | os.PathLike[str],
    *parts: str | os.PathLike[str],
) -> Path:
    """Return a path below one destination in the deliverable outbox."""
    path = get_destination_root(base_dir, destination)
    for index, part in enumerate(parts, start=1):
        path /= _validated_relative(part, f"sub-path part {index}", reject_dot=True)
    return path


def _validated_relative(
    value: str | os.PathLike[str], label: str, *, reject_dot: bool = False
) -> Path:
    raw = os.fspath(value)
    path = Path(raw)
    windows_path = PureWindowsPath(raw)
    posix_path = PurePosixPath(raw)

    if (
        path.is_absolute()
        or posix_path.is_absolute()
        or windows_path.is_absolute()
        or windows_path.drive
        or windows_path.root
    ):
        raise ValueError(f"{label} must be a relative path, got {raw!r}")

    if reject_dot and path == Path("."):
        raise ValueError(f"{label} must name a destination, got {raw!r}")

    if any(component == ".." for component in raw.replace("\\", "/").split("/")):
        raise ValueError(f"{label} must not contain '..' path traversal: {raw!r}")

    return path
