"""``Table`` / ``Column`` / ``Index`` construction, ``columns_of``, ``text_columns``,
``retype``, ``resolved_namespace``, and ``collect_declared_tables``.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Annotated

import pytest

from framework.core import NonNull
from tools.schema import declaration
from tools.schema.declaration import (
    ACCUMULATE_BY_RUN_COLUMNS,
    ACCUMULATE_BY_RUN_CONTEXT_COLUMNS,
    Column,
    Index,
    Table,
    collect_declared_tables,
    columns_of,
    resolved_namespace,
    retype,
    text_columns,
)


@dataclass
class _Row:
    record_id: str
    amount: Annotated[int, NonNull()]
    label: str | None
    opened: date


def test_columns_of_derives_one_column_per_field_in_order():
    columns = columns_of(_Row)

    assert columns == (
        Column("record_id", "TEXT", nullable=True),
        Column("amount", "INTEGER", nullable=False),
        Column("label", "TEXT", nullable=True),
        Column("opened", "TEXT", nullable=True),
    )


def test_columns_of_unmapped_type_defaults_to_text():
    @dataclass
    class Weird:
        payload: object

    assert columns_of(Weird) == (Column("payload", "TEXT", nullable=True),)


def test_text_columns_is_every_column_text_and_nullable():
    assert text_columns(["a", "b"]) == (
        Column("a", "TEXT", nullable=True),
        Column("b", "TEXT", nullable=True),
    )


def test_retype_overrides_only_the_named_columns():
    columns = columns_of(_Row)

    retyped = retype(columns, opened="TIMESTAMP", amount="REAL")

    assert retyped[1] == Column("amount", "REAL", nullable=False)
    assert retyped[3] == Column("opened", "TIMESTAMP", nullable=True)
    # Untouched columns and declaration order are preserved.
    assert retyped[0] == columns[0]
    assert [c.name for c in retyped] == [c.name for c in columns]


def test_retype_names_the_unknown_column_and_the_real_ones():
    with pytest.raises(ValueError, match="no column named 'not_a_field'") as caught:
        retype(columns_of(_Row), not_a_field="TEXT")

    # The message has to be enough to fix the typo without opening the source.
    assert "record_id" in str(caught.value)


def test_table_requires_exactly_one_of_row_or_columns():
    with pytest.raises(ValueError, match="exactly one of"):
        Table("raw", "t")
    with pytest.raises(ValueError, match="exactly one of"):
        Table("raw", "t", row=_Row, columns=text_columns(["x"]))


def test_table_from_row_derives_columns_and_exposes_label():
    table = Table("silver", "widgets", row=_Row, primary_key=("record_id",))

    assert table.columns == columns_of(_Row)
    assert table.primary_key == ("record_id",)
    assert table.label == "silver/widgets"


def test_table_from_explicit_columns_and_indexes():
    table = Table(
        "raw",
        "widgets",
        columns=text_columns(["a", "b"]),
        indexes=(Index("a", unique=True),),
    )

    assert table.columns == text_columns(["a", "b"])
    assert table.indexes == (Index("a", unique=True),)


def test_resolved_namespace_prefixes_a_bare_layer_with_the_feed():
    bare = Table("raw", "widgets", row=_Row)
    assert resolved_namespace(bare, "my_feed") == "my_feed/raw"


def test_resolved_namespace_leaves_a_platform_namespace_untouched():
    explicit = Table("other_subject/gold", "widgets", row=_Row)
    assert resolved_namespace(explicit, "my_feed") == "other_subject/gold"


def test_accumulate_by_run_columns_is_logical_run_id_and_load_date_not_null():
    assert ACCUMULATE_BY_RUN_COLUMNS == (
        Column("logical_run_id", "TEXT", nullable=False),
        Column("load_date", "TEXT", nullable=False),
    )


def test_the_from_context_variant_adds_only_pipeline_run_id():
    assert ACCUMULATE_BY_RUN_CONTEXT_COLUMNS == ACCUMULATE_BY_RUN_COLUMNS + (
        Column("pipeline_run_id", "TEXT"),
    )


def test_collect_declared_tables_finds_every_bundled_feed_with_tables():
    collected = collect_declared_tables()

    # A representative sample: one feed declaring TABLES on its schema.py, and
    # one (ingest, per the placement note in docs/schema-declaration.md)
    # declaring TABLES on pipeline.py instead.
    assert collected["complaints_a"]
    assert collected["ingest"]
    # demo_fan_out.py and __init__.py are not feed *packages*, so they are
    # simply absent, not an error.
    assert "demo_fan_out" not in collected


def test_a_feed_module_that_fails_to_import_is_not_treated_as_undeclared(monkeypatch):
    # A missing schema.py is "declares nothing"; a schema.py whose own imports
    # are broken is a broken feed, and must not read as clean.
    real_import = declaration.importlib.import_module

    def explode(name, *args, **kwargs):
        if name == "pipelines.complaints_a.schema":
            raise ModuleNotFoundError("No module named 'nowhere'", name="nowhere")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(declaration.importlib, "import_module", explode)

    with pytest.raises(ModuleNotFoundError, match="nowhere"):
        collect_declared_tables()
