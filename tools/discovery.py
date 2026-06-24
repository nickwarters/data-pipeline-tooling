"""Source-artifact discovery primitives for dated-file catch-up orchestration."""

from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class SourceArtifact:
    """A single dated source file discovered on disk.

    ``path`` is the resolved absolute path. ``business_date`` is the date
    encoded in the filename. ``file_id`` is a stable, run-independent
    identifier derived from the filename — safe as an ``AccumulateByRun``
    logical-run-id component.
    """

    path: Path
    business_date: dt.date
    file_id: str


class DatedFileDiscovery:
    """Discover source artifacts whose filenames encode a business date.

    The ``pattern`` uses ``{date:FORMAT}`` as a placeholder for the date
    portion and ``*`` as a wildcard for anything else::

        DatedFileDiscovery("/share/claims", "claims_{date:%Y%m%d}_*.csv")

    Call ``available_between(start, end)`` to retrieve artifacts whose
    ``business_date`` falls in the **exclusive-start, inclusive-end** range
    ``(start, end]``.  Pass the last successfully processed source date as
    *start* and the current run date as *end* to discover exactly the
    un-processed dates since the last successful run.

    Results are sorted by ``(business_date, path)`` for deterministic ordering
    across Windows and macOS.
    """

    def __init__(
        self,
        directory: str | Path,
        pattern: str,
    ) -> None:
        self._directory = Path(directory)
        self._glob_pattern, self._filename_regex, self._date_format = _compile(pattern)

    def available_between(self, start: dt.date, end: dt.date) -> list[SourceArtifact]:
        """Return artifacts where ``start < business_date <= end``.

        Results are sorted by ``(business_date, path)``.
        """
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
    """Return (glob_pattern, filename_regex, date_format) for a dated pattern."""
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
