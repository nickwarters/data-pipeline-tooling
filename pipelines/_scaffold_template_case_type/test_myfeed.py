"""Tests for the ``myfeed`` Case Type ingest (source -> raw -> silver).

The given-source / expect-landed pattern, end to end through the real CSV path:
the bundled sample lands faithfully in raw, then conforms to silver under the
Case Type's schema. The Case Type itself is asserted directly — it carries the
identity contract (ADR-0009) that distinguishes this variant from the generic
feed scaffold. Gold is deliberately not exercised here: how silver is assembled
into gold is the feed author's call (snapshot-vs-join — issue #163).
"""

from __future__ import annotations

from dataclasses import fields

from framework.io import RAW, SILVER, StoreCatalog
from framework.testing import read_rows

from .case_type import CASE_TYPE
from .pipeline import FEED_NAME, run
from .schema import MyfeedRow


def test_case_type_declares_its_identity_contract():
    # The unique value over the generic scaffold: identity is declared once on
    # the Case Type, so case_id derivation is owned in one place (ADR-0009). The
    # natural_key names a column the schema carries.
    assert CASE_TYPE.schema is MyfeedRow
    declared = {f.name for f in fields(MyfeedRow)}
    assert set(CASE_TYPE.natural_key) <= declared
    # The namespace derives from the name — no stored config (ADR-0009).
    assert CASE_TYPE.namespace is not None


def test_source_lands_in_raw_then_conforms_to_silver(tmp_path):
    # End to end through the real CSV path: bundled fixture -> raw.db -> silver.db
    # on disk, each read back through the Store's own Reader.
    silver = run(tmp_path)

    store = StoreCatalog(tmp_path).store(FEED_NAME)

    raw = read_rows(store, RAW, FEED_NAME)
    assert len(raw) > 0  # raw is a faithful, accumulated copy of the source

    silver_rows = read_rows(store, SILVER, FEED_NAME)
    assert len(silver_rows) == len(silver)
    # Silver carries every declared schema column, coerced + validated.
    declared = {f.name for f in fields(MyfeedRow)}
    assert declared.issubset(silver_rows[0].keys())
