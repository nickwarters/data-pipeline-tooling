"""Every feed's standard hops really are the shared recipe.

The point of ``tools.recipes`` is that the standard source -> raw and raw ->
silver hops have **one** definition, so a policy change ("every raw hop must
also run a drift check") is a one-line change in one function that every feed
inherits. That only holds while the feeds actually compose the recipe rather
than carrying a copy of its body, so this pins it: each converted feed's builder
must plan *identically* to the recipe it delegates to, node for node.

If a recipe grows a step, both sides of each assertion move together and these
tests stay green; a feed that forked the recipe's body would keep its old shape
and fail. Note the limit of that guarantee: the comparison is over the planned
shape, so a fork that happens to compose the *same* nodes today passes. What
these tests catch is the fork drifting once the recipe changes — which is the
case that matters, since a fork nobody notices is one that silently stops
inheriting policy.
"""

from __future__ import annotations

import shutil
from dataclasses import fields
from pathlib import Path

import pytest

from framework.run import RunContext
from pipelines.case_selection.pipeline import SUBJECT as CASE_SELECTION_SUBJECT
from pipelines.case_selection.pipeline import raw_builder as cs_raw_builder
from pipelines.case_selection.pipeline import silver_builder as cs_silver_builder
from pipelines.case_selection.schema import CaseReviewRow, SalesRow
from pipelines.complaints_a.schema import ComplaintsARow
from pipelines.complaints_b.schema import ComplaintsBRow
from pipelines.complaints_c.schema import ComplaintsCRow
from tests.framework_testing import RecordingWriter, given_rows, read_rows
from tools.medallion import medallion
from tools.recipes import raw_to_silver, source_to_raw
from tools.store import StoreRegistry

COMPLAINTS_FEEDS = ["complaints_a", "complaints_b", "complaints_c"]
COMPLAINTS_SCHEMAS = {
    "complaints_a": ComplaintsARow,
    "complaints_b": ComplaintsBRow,
    "complaints_c": ComplaintsCRow,
}


def _feed(name: str):
    import importlib

    return importlib.import_module(f"pipelines.{name}.pipeline")


@pytest.mark.parametrize("feed_name", COMPLAINTS_FEEDS)
def test_complaints_raw_hop_is_the_recipe(feed_name):
    module = _feed(feed_name)
    reader, writer = given_rows([]), RecordingWriter()

    assert (
        module.raw_builder(reader, writer).describe()
        == source_to_raw(
            reader,
            writer,
            expected_columns=module.SOURCE_COLUMNS,
            name=f"{module.FEED_NAME}:raw",
        ).describe()
    )


@pytest.mark.parametrize("feed_name", COMPLAINTS_FEEDS)
def test_complaints_silver_hop_is_the_recipe(feed_name):
    module = _feed(feed_name)
    reader, writer, rejects = given_rows([]), RecordingWriter(), RecordingWriter()

    assert (
        module.silver_builder(reader, writer, rejects).describe()
        == raw_to_silver(
            reader,
            writer,
            schema=COMPLAINTS_SCHEMAS[feed_name],
            reject_writer=rejects,
            name=f"{module.FEED_NAME}:silver",
        ).describe()
    )


@pytest.mark.parametrize("feed_name", COMPLAINTS_FEEDS)
def test_complaints_operational_paths_do_not_follow_identity_namespace(
    feed_name, monkeypatch, tmp_path
):
    module = _feed(feed_name)
    landing = tmp_path / "landing_zone"
    landing.mkdir()
    sample = (
        Path(__file__).parent.parent.parent
        / "pipelines"
        / feed_name
        / "sample_data"
        / f"{feed_name}.csv"
    )
    shutil.copy(sample, landing / f"{feed_name}.csv")

    monkeypatch.setattr(module, "NAMESPACE", f"changed_{feed_name}")
    module.run(RunContext(base_dir=tmp_path, pipeline=module.FEED_NAME))

    med = medallion(StoreRegistry(tmp_path), module.FEED_NAME)
    assert read_rows(med.raw, module.FEED_NAME)
    assert read_rows(med.silver, module.FEED_NAME)
    assert not (tmp_path / f"changed_{feed_name}").exists()


@pytest.mark.parametrize("schema", [SalesRow, CaseReviewRow])
def test_case_selection_hops_are_the_recipe(schema):
    reader, writer = given_rows([]), RecordingWriter()

    assert (
        cs_raw_builder(reader, writer, schema).describe()
        == source_to_raw(
            reader,
            writer,
            expected_columns=[f.name for f in fields(schema)],
            name=f"{CASE_SELECTION_SUBJECT}:raw",
        ).describe()
    )
    assert (
        cs_silver_builder(reader, writer, schema).describe()
        == raw_to_silver(
            reader,
            writer,
            schema=schema,
            name=f"{CASE_SELECTION_SUBJECT}:silver",
        ).describe()
    )


def test_every_recipe_composed_raw_hop_plans_the_same_steps():
    """One standard shape across every feed, whatever that shape currently is.

    Deliberately *not* pinned to a literal step list: a policy change to the
    standard raw hop should not need this test edited, only the one recipe. What
    must hold is that all of them move together.
    """
    reader, writer = given_rows([]), RecordingWriter()
    plans = {
        feed_name: [
            line.split()[1]
            for line in _feed(feed_name)
            .raw_builder(reader, writer)
            .describe()
            .split("\n")[1:]
        ]
        for feed_name in COMPLAINTS_FEEDS
    }
    plans[CASE_SELECTION_SUBJECT] = [
        line.split()[1]
        for line in cs_raw_builder(reader, writer, SalesRow).describe().split("\n")[1:]
    ]

    assert len(set(map(tuple, plans.values()))) == 1, plans
