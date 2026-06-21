import sqlite3

import pandas as pd
import pytest

from framework.core.dataset import Dataset
from framework.io.readers import SqliteReader
from framework.io.sql import quote_identifier
from framework.io.writers import (
    AccumulateByRunWriter,
    QuarantineWriter,
    SqliteTruncateReloadWriter,
    SqliteUpsertWriter,
)


def test_plain_name_is_wrapped_in_double_quotes():
    assert quote_identifier("advisers") == '"advisers"'


def test_embedded_double_quote_is_doubled():
    # The escape that neutralises injection: a quote inside the name can never
    # close the quoting and start fresh SQL.
    assert quote_identifier('a"b') == '"a""b"'


def test_name_with_spaces_hyphens_and_reserved_word_is_quoted():
    # Correctness: names that are illegal unquoted become legal once quoted.
    assert quote_identifier("order by") == '"order by"'
    assert quote_identifier("sort-key") == '"sort-key"'


def test_mixed_case_name_is_preserved_by_quoting():
    # Quoting preserves case verbatim — important on case-insensitive platforms
    # (Windows, default macOS) where a bare identifier would fold.
    assert quote_identifier("CasePool") == '"CasePool"'
    assert quote_identifier("Case_ID") == '"Case_ID"'


def test_reader_reads_a_table_whose_name_needs_quoting(tmp_path):
    db = tmp_path / "layer.db"
    con = sqlite3.connect(db)
    try:
        # A reserved word plus a space — illegal as a bare identifier.
        con.execute('CREATE TABLE "order detail" (id INTEGER)')
        con.executemany('INSERT INTO "order detail" VALUES (?)', [(1,), (2,)])
        con.commit()
    finally:
        con.close()

    dataset = SqliteReader(db, "order detail").read()

    assert len(dataset) == 2


def test_reader_projects_a_column_whose_name_needs_quoting(tmp_path):
    db = tmp_path / "layer.db"
    con = sqlite3.connect(db)
    try:
        con.execute('CREATE TABLE advisers (id INTEGER, "full name" TEXT)')
        con.execute("INSERT INTO advisers VALUES (1, ?)", ("Ada",))
        con.commit()
    finally:
        con.close()

    dataset = SqliteReader(db, "advisers", columns=["full name"]).read()

    assert dataset.columns == ["full name"]


def test_upsert_writer_merges_into_table_and_columns_needing_quoting(tmp_path):
    db = tmp_path / "gold.db"
    writer = SqliteUpsertWriter(db, "case pool", key_columns=("case id",))

    writer.write(
        Dataset.from_pandas(
            pd.DataFrame({"case id": [1, 2], "full name": ["Ada", "Linus"]})
        )
    )
    # A second batch updates row 1 and inserts row 3.
    writer.write(
        Dataset.from_pandas(
            pd.DataFrame({"case id": [1, 3], "full name": ["Ada Lovelace", "Grace"]})
        )
    )

    result = SqliteReader(db, "case pool").read().to_pandas()
    by_id = dict(zip(result["case id"], result["full name"]))
    assert by_id == {1: "Ada Lovelace", 2: "Linus", 3: "Grace"}


def test_truncate_reload_writer_round_trips_a_table_name_needing_quoting(tmp_path):
    # This writer builds no SQL itself — it delegates to pandas to_sql, which
    # quotes the table name. The round-trip proves an awkward name still works.
    db = tmp_path / "raw.db"
    frame = pd.DataFrame({"id": [1, 2]})

    SqliteTruncateReloadWriter(db, "order detail").write(Dataset.from_pandas(frame))
    # Full refresh: a second write replaces, not appends.
    SqliteTruncateReloadWriter(db, "order detail").write(Dataset.from_pandas(frame))

    result = SqliteReader(db, "order detail").read()
    assert len(result) == 2


def test_accumulate_writer_deletes_by_run_in_table_needing_quoting(tmp_path):
    db = tmp_path / "gold.db"
    frame = pd.DataFrame({"case id": [1, 2]})

    AccumulateByRunWriter(db, "case pool", run_id="r1", load_date="2026-06-10").write(
        Dataset.from_pandas(frame)
    )
    # Re-driving run r1 must replace only its own rows, not double them.
    AccumulateByRunWriter(db, "case pool", run_id="r1", load_date="2026-06-10").write(
        Dataset.from_pandas(frame)
    )

    result = SqliteReader(db, "case pool").read()
    assert len(result) == 2


def test_quarantine_writer_deletes_by_run_in_table_needing_quoting(tmp_path):
    db = tmp_path / "raw.db"
    writer = QuarantineWriter(db, "reject rows")

    writer.write(Dataset.from_pandas(pd.DataFrame({"run_id": ["r1"], "v": [1]})))
    # Re-driving run r1 replaces its own reject, not appends.
    writer.write(Dataset.from_pandas(pd.DataFrame({"run_id": ["r1"], "v": [2]})))

    result = SqliteReader(db, "reject rows").read()
    assert len(result) == 1


def test_raw_table_columns_inspects_a_table_whose_name_needs_quoting(tmp_path):
    from framework.io.store import RawTableColumns

    db = tmp_path / "raw.db"
    con = sqlite3.connect(db)
    try:
        con.execute('CREATE TABLE "order detail" (id INTEGER, "full name" TEXT)')
        con.commit()
    finally:
        con.close()

    columns = RawTableColumns(db, "order detail", layer="raw").columns()

    assert columns == ("id", "full name")


def test_injection_in_a_table_name_cannot_drop_a_table(tmp_path):
    # A malicious table name must be treated as one (quoted) identifier, never
    # as SQL that breaks out of the statement.
    db = tmp_path / "layer.db"
    con = sqlite3.connect(db)
    try:
        con.execute("CREATE TABLE victim (id INTEGER)")
        con.execute("INSERT INTO victim VALUES (1)")
        con.commit()
    finally:
        con.close()

    evil = 'nope"; DROP TABLE victim; --'
    with pytest.raises(Exception):
        # The name is quoted as a single identifier, so the read fails to find
        # such a table rather than executing the embedded DROP.
        SqliteReader(db, evil).read()

    survivor = SqliteReader(db, "victim").read()
    assert len(survivor) == 1
