"""Source-artifact discovery primitives for dated-file catch-up orchestration."""

from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class SourceArtifact:
    """A source file with its resolved path, business date, and stable file ID."""

    path: Path
    business_date: dt.date
    file_id: str


class DatedFileDiscovery:
    """Discover dated filenames in ``(start, end]`` business-date order.

    ``pattern`` marks the date with ``{date:FORMAT}``. Results are ordered by
    date then path for deterministic behavior on Windows and macOS.
    """

    def __init__(
        self,
        directory: str | Path,
        pattern: str,
    ) -> None:
        self._directory = Path(directory)
        self._glob_pattern, self._filename_regex, self._date_format = _compile(pattern)

    def available_between(self, start: dt.date, end: dt.date) -> list[SourceArtifact]:
        artifacts: list[SourceArtifact] = []
        for path in self._directory.glob(self._glob_pattern):
            match = self._filename_regex.match(path.name)
            if match is None:
                continue
            try:
                business_date = dt.datetime.strptime(
                    match.group("date"), self._date_format
                ).date()
            except ValueError:
                continue
            if start < business_date <= end:
                artifacts.append(
                    SourceArtifact(
                        path=path.resolve(),
                        business_date=business_date,
                        file_id=path.name,
                    )
                )
        return sorted(artifacts, key=lambda a: (a.business_date, a.path))


def _compile(pattern: str) -> tuple[str, re.Pattern[str], str]:
    placeholder = re.search(r"\{date:([^}]+)\}", pattern)
    if placeholder is None:
        raise ValueError(
            f"Pattern {pattern!r} must contain a {{date:FORMAT}} placeholder, "
            "e.g. 'claims_{{date:%Y%m%d}}_*.csv'"
        )
    date_format = placeholder.group(1)

    before = pattern[: placeholder.start()]
    after = pattern[placeholder.end() :]

    glob_pattern = before + "*" + after

    def _glob_fragment_to_regex(s: str) -> str:
        return re.escape(s).replace(r"\*", "[^/]*")

    regex = (
        r"^"
        + _glob_fragment_to_regex(before)
        + r"(?P<date>.+?)"
        + _glob_fragment_to_regex(after)
        + r"$"
    )
    return glob_pattern, re.compile(regex), date_format
