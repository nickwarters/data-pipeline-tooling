"""Scope-from-path classification, and its rejections."""

from __future__ import annotations

from pathlib import PurePosixPath

import pytest

from tools.migrations.scope import (
    MigrationTreeError,
    parse_scope_dir,
    scope_from_label,
)


def test_shared_scope():
    scope = parse_scope_dir(PurePosixPath("_shared"))
    assert scope.kind == "shared"
    assert scope.label == "_shared"


def test_layer_scope():
    scope = parse_scope_dir(PurePosixPath("layer/silver"))
    assert scope.kind == "layer"
    assert scope.layer == "silver"
    assert scope.label == "layer/silver"


def test_subject_layer_scope():
    scope = parse_scope_dir(PurePosixPath("subject/complaints_a/silver"))
    assert scope.kind == "subject_layer"
    assert scope.subject == "complaints_a"
    assert scope.layer == "silver"
    assert scope.label == "subject/complaints_a/silver"


def test_a_subjects_quarantine_is_a_recognised_layer():
    # `quarantine` joined raw/silver/gold in VALID_LAYERS (#324): a feed's
    # reject table is a real landing site, migrated like any other, and
    # `subject/<subject>/<layer>/` already fits it -- one more recognised
    # value, not a new scope kind.
    scope = parse_scope_dir(PurePosixPath("subject/complaints_a/quarantine"))
    assert scope.kind == "subject_layer"
    assert scope.subject == "complaints_a"
    assert scope.layer == "quarantine"
    assert scope.label == "subject/complaints_a/quarantine"


def test_platform_scope():
    scope = parse_scope_dir(PurePosixPath("platform/registry"))
    assert scope.kind == "platform"
    assert scope.name == "registry"


@pytest.mark.parametrize(
    "path",
    [
        "layer/bronze",  # unrecognised layer name
        "subject/complaints_a/bronze",  # unrecognised layer under subject
        "subject/complaints_a",  # missing the layer segment
        "misc",  # not a recognised top-level scope at all
        "layer/silver/extra",  # extra path segment
    ],
)
def test_unrecognised_directories_raise(path):
    with pytest.raises(MigrationTreeError):
        parse_scope_dir(PurePosixPath(path))


def test_scope_from_label_round_trips_with_label():
    for label in (
        "_shared",
        "layer/gold",
        "subject/x/raw",
        "platform/registry",
    ):
        assert scope_from_label(label).label == label
