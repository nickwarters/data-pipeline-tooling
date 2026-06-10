from pathlib import Path

import pandas as pd
import pytest

from framework.builder import Pipeline
from framework.readers import ExcelReader
from framework.writers import SqliteTruncateReloadWriter


@pytest.fixture
def workbook(tmp_path) -> Path:
    # A local multi-sheet fixture workbook (no external system). The first sheet
    # is the feed; a second sheet stands in for an unrelated tab so sheet
    # selection is observable.
    path = tmp_path / "cases.xlsx"
    with pd.ExcelWriter(path) as writer:
        pd.DataFrame(
            {"case_id": [1, 2, 3], "advisor": ["a", "b", "c"]}
        ).to_excel(writer, sheet_name="cases", index=False)
        pd.DataFrame({"region": ["north", "south"]}).to_excel(
            writer, sheet_name="reference", index=False
        )
    return path


def test_read_returns_dataset_from_the_first_sheet(workbook):
    dataset = ExcelReader(workbook).read()

    # Observed only through the Dataset's public surface — the test never
    # touches pandas (ADR-0002 swappable engine seam).
    assert dataset.columns == ["case_id", "advisor"]
    assert len(dataset) == 3


def test_reads_a_selected_sheet_by_name(workbook):
    # A workbook can carry several tabs; the reader targets the named one.
    dataset = ExcelReader(workbook, sheet="reference").read()

    assert dataset.columns == ["region"]
    assert len(dataset) == 2


def test_excel_reader_composes_in_the_pipeline_builder(workbook, tmp_path):
    # An ExcelReader is a Reader: it drops into the deferred builder and feeds a
    # raw landing exactly like any other source (Reader-Protocol conformance,
    # observed end-to-end rather than via isinstance).
    landed = (
        Pipeline("cases", ExcelReader(workbook))
        .write_to(SqliteTruncateReloadWriter(tmp_path / "raw.db", "cases"))
        .run()
    )

    assert landed.columns == ["case_id", "advisor"]
    assert len(landed) == 3
