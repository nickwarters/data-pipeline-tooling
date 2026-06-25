import datetime as dt

import pytest

from framework.core.dataset import Dataset
from framework.io.readers import CsvReader
from framework.run.builder import Pipeline
from framework.run.run_context import RunContext
from tools.discovery import DatedFileDiscovery, SourceArtifact
from tools.orchestration import ForEach


class CapturingWriter:
    def __init__(self) -> None:
        self.written: list[Dataset] = []

    def write(self, dataset: Dataset) -> None:
        self.written.append(dataset)


def _touch(tmp_path, *names):
    for name in names:
        (tmp_path / name).touch()


def _write_csv(tmp_path, name, content="value\n1\n"):
    (tmp_path / name).write_text(content)


def _discover(tmp_path, pattern, start, end):
    return DatedFileDiscovery(tmp_path, pattern).available_between(start, end)


# ---------------------------------------------------------------------------
# SourceArtifact
# ---------------------------------------------------------------------------


class TestSourceArtifact:
    def test_is_immutable(self, tmp_path):
        artifact = SourceArtifact(
            path=tmp_path / "file.csv",
            business_date=dt.date(2026, 6, 1),
            file_id="file.csv",
        )
        with pytest.raises(Exception):
            artifact.path = tmp_path / "other.csv"  # type: ignore[misc]

    def test_equality_by_value(self, tmp_path):
        a = SourceArtifact(tmp_path / "a.csv", dt.date(2026, 6, 1), "a.csv")
        b = SourceArtifact(tmp_path / "a.csv", dt.date(2026, 6, 1), "a.csv")
        assert a == b


# ---------------------------------------------------------------------------
# DatedFileDiscovery — date range filtering
# ---------------------------------------------------------------------------


class TestAvailableBetween:
    def test_monday_catchup_finds_saturday_sunday_monday(self, tmp_path):
        """The canonical catch-up case: three files discovered, Friday excluded."""
        _touch(
            tmp_path,
            "claims_20260619.csv",  # Friday — already processed
            "claims_20260620.csv",  # Saturday
            "claims_20260621.csv",  # Sunday
            "claims_20260622.csv",  # Monday
        )
        friday = dt.date(2026, 6, 19)
        monday = dt.date(2026, 6, 22)

        artifacts = _discover(tmp_path, "claims_{date:%Y%m%d}.csv", friday, monday)

        assert [a.business_date for a in artifacts] == [
            dt.date(2026, 6, 20),
            dt.date(2026, 6, 21),
            dt.date(2026, 6, 22),
        ]

    def test_start_is_exclusive(self, tmp_path):
        """A file exactly on the start date is not returned."""
        _touch(tmp_path, "claims_20260620.csv")
        saturday = dt.date(2026, 6, 20)

        artifacts = _discover(tmp_path, "claims_{date:%Y%m%d}.csv", saturday, saturday)

        assert artifacts == []

    def test_end_is_inclusive(self, tmp_path):
        """A file exactly on the end date is returned."""
        _touch(tmp_path, "claims_20260620.csv")
        friday = dt.date(2026, 6, 19)
        saturday = dt.date(2026, 6, 20)

        artifacts = _discover(tmp_path, "claims_{date:%Y%m%d}.csv", friday, saturday)

        assert len(artifacts) == 1
        assert artifacts[0].business_date == saturday

    def test_empty_when_no_files_in_range(self, tmp_path):
        _touch(tmp_path, "claims_20260615.csv")

        artifacts = _discover(
            tmp_path,
            "claims_{date:%Y%m%d}.csv",
            dt.date(2026, 6, 19),
            dt.date(2026, 6, 22),
        )

        assert artifacts == []

    def test_empty_when_no_matching_files_at_all(self, tmp_path):
        _touch(tmp_path, "unrelated.csv")

        artifacts = _discover(
            tmp_path,
            "claims_{date:%Y%m%d}.csv",
            dt.date(2026, 6, 1),
            dt.date(2026, 6, 30),
        )

        assert artifacts == []


# ---------------------------------------------------------------------------
# DatedFileDiscovery — multiple files per date
# ---------------------------------------------------------------------------


class TestMultipleFilesPerDate:
    def test_all_files_for_each_date_are_discovered(self, tmp_path):
        _touch(
            tmp_path,
            "claims_20260620_batch1.csv",
            "claims_20260620_batch2.csv",
            "claims_20260621_batch1.csv",
        )

        artifacts = _discover(
            tmp_path,
            "claims_{date:%Y%m%d}_*.csv",
            dt.date(2026, 6, 19),
            dt.date(2026, 6, 22),
        )

        assert len(artifacts) == 3
        assert artifacts[0].business_date == dt.date(2026, 6, 20)
        assert artifacts[1].business_date == dt.date(2026, 6, 20)
        assert artifacts[2].business_date == dt.date(2026, 6, 21)

    def test_three_files_same_date_all_returned(self, tmp_path):
        _touch(
            tmp_path,
            "feed_20260620_a.csv",
            "feed_20260620_b.csv",
            "feed_20260620_c.csv",
        )

        artifacts = _discover(
            tmp_path,
            "feed_{date:%Y%m%d}_*.csv",
            dt.date(2026, 6, 19),
            dt.date(2026, 6, 20),
        )

        assert len(artifacts) == 3


# ---------------------------------------------------------------------------
# DatedFileDiscovery — deterministic ordering
# ---------------------------------------------------------------------------


class TestDeterministicOrder:
    def test_sorted_by_date_then_path(self, tmp_path):
        _touch(
            tmp_path,
            "claims_20260621_b.csv",
            "claims_20260620_b.csv",
            "claims_20260620_a.csv",
            "claims_20260621_a.csv",
        )

        artifacts = _discover(
            tmp_path,
            "claims_{date:%Y%m%d}_*.csv",
            dt.date(2026, 6, 19),
            dt.date(2026, 6, 22),
        )

        names = [a.path.name for a in artifacts]
        assert names == [
            "claims_20260620_a.csv",
            "claims_20260620_b.csv",
            "claims_20260621_a.csv",
            "claims_20260621_b.csv",
        ]

    def test_stable_across_repeated_calls(self, tmp_path):
        _touch(tmp_path, "f_20260620_b.csv", "f_20260620_a.csv")
        discovery = DatedFileDiscovery(tmp_path, "f_{date:%Y%m%d}_*.csv")
        start = dt.date(2026, 6, 19)
        end = dt.date(2026, 6, 20)

        first = [a.path.name for a in discovery.available_between(start, end)]
        second = [a.path.name for a in discovery.available_between(start, end)]

        assert first == second


# ---------------------------------------------------------------------------
# DatedFileDiscovery — SourceArtifact fields
# ---------------------------------------------------------------------------


class TestArtifactFields:
    def test_file_id_equals_filename(self, tmp_path):
        _touch(tmp_path, "claims_20260620.csv")

        artifact = _discover(
            tmp_path,
            "claims_{date:%Y%m%d}.csv",
            dt.date(2026, 6, 19),
            dt.date(2026, 6, 20),
        )[0]

        assert artifact.file_id == "claims_20260620.csv"

    def test_file_id_stable_for_wildcard_pattern(self, tmp_path):
        _touch(tmp_path, "claims_20260620_batch1.csv")

        artifact = _discover(
            tmp_path,
            "claims_{date:%Y%m%d}_*.csv",
            dt.date(2026, 6, 19),
            dt.date(2026, 6, 20),
        )[0]

        assert artifact.file_id == "claims_20260620_batch1.csv"

    def test_path_is_absolute(self, tmp_path):
        _touch(tmp_path, "claims_20260620.csv")

        artifact = _discover(
            tmp_path,
            "claims_{date:%Y%m%d}.csv",
            dt.date(2026, 6, 19),
            dt.date(2026, 6, 20),
        )[0]

        assert artifact.path.is_absolute()

    def test_date_formats_with_separators(self, tmp_path):
        _touch(tmp_path, "feed_2026-06-20.csv")

        artifact = _discover(
            tmp_path,
            "feed_{date:%Y-%m-%d}.csv",
            dt.date(2026, 6, 19),
            dt.date(2026, 6, 20),
        )[0]

        assert artifact.business_date == dt.date(2026, 6, 20)


# ---------------------------------------------------------------------------
# DatedFileDiscovery — invalid pattern
# ---------------------------------------------------------------------------


class TestInvalidPattern:
    def test_missing_date_placeholder_raises(self):
        with pytest.raises(ValueError, match="date"):
            DatedFileDiscovery("/any", "claims_*.csv")


# ---------------------------------------------------------------------------
# ForEach integration
# ---------------------------------------------------------------------------


class TestForEachIntegration:
    def test_each_artifact_gets_its_own_logical_run_id(self, tmp_path):
        """Each discovered file runs as a separate logical run via ForEach."""
        _write_csv(tmp_path, "feed_20260620.csv")
        _write_csv(tmp_path, "feed_20260621.csv")

        files = _discover(
            tmp_path,
            "feed_{date:%Y%m%d}.csv",
            dt.date(2026, 6, 19),
            dt.date(2026, 6, 21),
        )

        seen_run_ids: list[str] = []

        def pipeline_builder(artifact: SourceArtifact, context: RunContext) -> Pipeline:
            seen_run_ids.append(context.logical_run_id)
            writer = CapturingWriter()
            p = Pipeline("ingest")
            r = p.read(CsvReader(artifact.path), name="read")
            p.write(writer, r, name="write")
            return p

        ForEach(
            files,
            pipeline_builder,
            logical_run_id=lambda a, _i, _c: f"claims:ingest:{a.file_id}",
        ).run(RunContext())

        assert seen_run_ids == [
            "claims:ingest:feed_20260620.csv",
            "claims:ingest:feed_20260621.csv",
        ]

    def test_foreach_runs_once_per_artifact(self, tmp_path):
        """ForEach calls pipeline_builder exactly once per discovered artifact."""
        _write_csv(tmp_path, "feed_20260620.csv")
        _write_csv(tmp_path, "feed_20260621.csv")
        _write_csv(tmp_path, "feed_20260622.csv")

        files = _discover(
            tmp_path,
            "feed_{date:%Y%m%d}.csv",
            dt.date(2026, 6, 19),
            dt.date(2026, 6, 22),
        )

        call_count = 0

        def pipeline_builder(
            artifact: SourceArtifact, _context: RunContext
        ) -> Pipeline:
            nonlocal call_count
            call_count += 1
            writer = CapturingWriter()
            p = Pipeline("ingest")
            r = p.read(CsvReader(artifact.path), name="read")
            p.write(writer, r, name="write")
            return p

        ForEach(files, pipeline_builder).run(RunContext())

        assert call_count == 3

    def test_child_run_context_inherits_run_date(self, tmp_path):
        """Each child RunContext carries the parent run_date."""
        _write_csv(tmp_path, "feed_20260620.csv")

        files = _discover(
            tmp_path,
            "feed_{date:%Y%m%d}.csv",
            dt.date(2026, 6, 19),
            dt.date(2026, 6, 20),
        )

        seen_dates: list[dt.date] = []
        run_date = dt.date(2026, 6, 22)

        def pipeline_builder(artifact: SourceArtifact, context: RunContext) -> Pipeline:
            seen_dates.append(context.run_date)
            writer = CapturingWriter()
            p = Pipeline("ingest")
            r = p.read(CsvReader(artifact.path), name="read")
            p.write(writer, r, name="write")
            return p

        ForEach(files, pipeline_builder).run(RunContext(run_date=run_date))

        assert seen_dates == [run_date]
