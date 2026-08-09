from pathlib import Path

import pytest

from tools.deliverables import (
    REPORT_FEEDS_DESTINATION,
    get_deliverable_path,
    get_deliverable_root,
    get_destination_root,
)


def test_deliverable_root_accepts_string_and_pathlike_base_dirs(tmp_path):
    assert get_deliverable_root(str(tmp_path)) == tmp_path / "deliverables"
    assert get_deliverable_root(tmp_path) == tmp_path / "deliverables"


def test_destination_and_nested_deliverable_paths_have_expected_layout(tmp_path):
    assert get_destination_root(tmp_path, REPORT_FEEDS_DESTINATION) == (
        tmp_path / "deliverables" / "cora_report_feeds"
    )
    assert get_deliverable_path(
        tmp_path, REPORT_FEEDS_DESTINATION, "my-stats", "2026", "report.txt"
    ) == (
        tmp_path
        / "deliverables"
        / "cora_report_feeds"
        / "my-stats"
        / "2026"
        / "report.txt"
    )


def test_deliverable_helpers_return_paths_without_creating_directories(tmp_path):
    result = get_deliverable_path(tmp_path, "reports", "report.txt")
    assert isinstance(result, Path)
    assert not (tmp_path / "deliverables").exists()


@pytest.mark.parametrize(
    "invalid",
    [
        "/absolute/path",
        "C:/absolute/path",
        r"C:\\absolute\\path",
        r"C:relative\\path",
        r"\\server\\share\\path",
        "//server/share/path",
        "../outside",
        "nested/../outside",
        r"nested\\..\\outside",
    ],
)
def test_destination_rejects_invalid_relative_paths(tmp_path, invalid):
    with pytest.raises(ValueError, match="relative|traversal"):
        get_destination_root(tmp_path, invalid)


def test_sub_path_parts_reject_invalid_relative_paths(tmp_path):
    with pytest.raises(ValueError, match="traversal"):
        get_deliverable_path(tmp_path, "reports", "nested", "..", "report.txt")


@pytest.mark.parametrize("invalid", ["", ".", Path(".")])
def test_sub_path_parts_reject_empty_or_dot_paths(tmp_path, invalid):
    with pytest.raises(ValueError, match="sub-path part"):
        get_deliverable_path(tmp_path, "reports", invalid)


@pytest.mark.parametrize("invalid", ["", ".", Path(".")])
def test_destination_rejects_empty_or_dot_paths(tmp_path, invalid):
    with pytest.raises(ValueError, match="destination"):
        get_destination_root(tmp_path, invalid)
