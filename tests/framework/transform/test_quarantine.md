```python
"""Quarantine row-level value-rule partitioning and pipeline integration.

Tests the opt-in quarantine path: value-rule-failing rows are routed to a
reject table; good rows proceed. Structural breaches (missing columns, wrong
dtypes) still abort via SchemaValidator; the abort-vs-quarantine boundary is
the key invariant.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated

import pandas as pd
import pytest

from framework.core import Length, OneOf, Pattern, RowCheck, Unique, row_checks
from framework.core.dataset import Dataset
from framework.transform.quarantine import SchemaValueRulePartitioner


@dataclass
class RefCase:
    case_ref: Annotated[str, Pattern(r"\d{9,10}")]
    status: Annotated[str, OneOf("open", "closed")]


def _amount_within_limit(row) -> str | None:
    if pd.notna(row["amount"]) and pd.notna(row["limit"]):
        if row["amount"] > row["limit"]:
            return "amount exceeds limit"
    return None


@row_checks(RowCheck(("amount", "limit"), _amount_within_limit))
@dataclass
class ExposureCase:
    amount: int
    limit: int


def _dataset(**cols) -> Dataset:
    return Dataset.from_pandas(pd.DataFrame(cols))


def test_partitioner_routes_violating_rows_to_rejected():
    # A row with a case_ref that doesn't match the 9–10 digit pattern is a
    # value-rule breach; it should land in rejected, not in good.
    ds = _dataset(
        case_ref=pd.Series(["123456789", "BAD", "987654321"], dtype="string"),
        status=pd.Series(["open", "open", "closed"], dtype="string"),
    )
    good, rejected = SchemaValueRulePartitioner(RefCase).partition(ds)

    assert len(good) == 2
    assert len(rejected) == 1


def test_partitioner_all_good_when_no_violations():
    # When every row satisfies all value rules, good == full dataset and
    # rejected is empty.
    ds = _dataset(
        case_ref=pd.Series(["123456789", "1234567890"], dtype="string"),
        status=pd.Series(["open", "closed"], dtype="string"),
    )
    good, rejected = SchemaValueRulePartitioner(RefCase).partition(ds)

    assert len(good) == 2
    assert len(rejected) == 0


def test_partitioner_rejected_rows_carry_failed_rule_column():
    # Rejected rows must name the breach so operators can diagnose the reject
    # table without re-running the pipeline.
    ds = _dataset(
        case_ref=pd.Series(["BAD"], dtype="string"),
        status=pd.Series(["open"], dtype="string"),
    )
    _, rejected = SchemaValueRulePartitioner(RefCase).partition(ds)

    assert "failed_rule" in rejected.to_pandas().columns
    assert "case_ref" in rejected.to_pandas()["failed_rule"].iloc[0]


def test_partitioner_row_failing_multiple_rules_gets_all_reasons():
    # A row that breaches two rules (bad pattern AND bad status) should have
    # both breach descriptions in failed_rule (semicolon-joined).
    ds = _dataset(
        case_ref=pd.Series(["BAD"], dtype="string"),
        status=pd.Series(["pending"], dtype="string"),  # not in {open, closed}
    )
    _, rejected = SchemaValueRulePartitioner(RefCase).partition(ds)

    reason = rejected.to_pandas()["failed_rule"].iloc[0]
    assert "case_ref" in reason
    assert "status" in reason


def test_partitioner_routes_row_check_breaches_to_rejected():
    # A row check is horizontal but quarantines like a value rule: the row whose
    # amount exceeds its limit lands in rejected with the check's phrase; the
    # conforming rows proceed.
    ds = _dataset(
        amount=pd.Series([10, 99, 30], dtype="int64"),
        limit=pd.Series([100, 50, 100], dtype="int64"),
    )
    good, rejected = SchemaValueRulePartitioner(ExposureCase).partition(ds)

    assert len(good) == 2
    assert len(rejected) == 1
    assert "amount exceeds limit" in rejected.to_pandas()["failed_rule"].iloc[0]


def test_partitioner_skips_row_check_when_a_spanned_column_is_missing():
    # The same footprint guard the validator applies: with 'limit' absent the
    # check is skipped rather than crashing, so every row proceeds as good.
    ds = _dataset(amount=pd.Series([10, 20], dtype="int64"))
    good, rejected = SchemaValueRulePartitioner(ExposureCase).partition(ds)

    assert len(good) == 2
    assert len(rejected) == 0


def test_pattern_violating_mask_returns_true_for_non_matching_rows():
    rule = Pattern(r"\d{9,10}")
    series = pd.Series(["123456789", "BAD", "1234567890"], dtype="string")
    mask = rule.violating_mask(series)
    assert list(mask) == [False, True, False]


def test_pattern_violating_mask_returns_false_for_nulls():
    # Null values are not a pattern violation (nullability is separate).
    rule = Pattern(r"\d+")
    series = pd.Series(["123", pd.NA, "456"], dtype="string")
    mask = rule.violating_mask(series)
    assert list(mask) == [False, False, False]


def test_length_violating_mask_returns_true_for_out_of_bounds():
    rule = Length(minimum=2, maximum=4)
    series = pd.Series(["ok", "x", "four", "toolong"], dtype="string")
    mask = rule.violating_mask(series)
    assert list(mask) == [False, True, False, True]


def test_one_of_violating_mask_returns_true_for_non_members():
    rule = OneOf("open", "closed")
    series = pd.Series(["open", "pending", "closed"], dtype="string")
    mask = rule.violating_mask(series)
    assert list(mask) == [False, True, False]


def test_unique_violating_mask_returns_true_for_duplicate_rows():
    rule = Unique()
    series = pd.Series(["a", "dup", "b", "dup"], dtype="string")
    mask = rule.violating_mask(series)
    assert list(mask) == [False, True, False, True]


def test_pipeline_quarantine_routes_rejected_rows_to_reject_writer(tmp_path):
    # A pipeline configured with quarantine should write bad rows to the reject
    # writer and good rows to the main writer — in the same run.
    import sqlite3

    from framework.io.readers import CsvReader
    from framework.io.writers import QuarantineWriter, SqliteTruncateReloadWriter
    from framework.run.builder import Pipeline
    from framework.transform.quarantine import SchemaValueRulePartitioner

    csv_file = tmp_path / "feed.csv"
    csv_file.write_text("case_ref,status\n123456789,open\nBAD,open\n987654321,closed\n")

    main_db = tmp_path / "main.db"
    reject_db = tmp_path / "rejects.db"

    p = Pipeline("test-feed")
    r = p.read(CsvReader(csv_file), name="read")
    q = p.quarantine(
        SchemaValueRulePartitioner(RefCase),
        QuarantineWriter(reject_db, "rejects"),
        r,
        name="quarantine",
    )
    p.write(SqliteTruncateReloadWriter(main_db, "feed"), q, name="write")
    p.run()

    con_main = sqlite3.connect(main_db)
    rows_main = con_main.execute("SELECT * FROM feed").fetchall()
    con_main.close()

    con_reject = sqlite3.connect(reject_db)
    rows_reject = con_reject.execute("SELECT * FROM rejects").fetchall()
    cols_reject = [
        d[1] for d in con_reject.execute("PRAGMA table_info(rejects)").fetchall()
    ]
    con_reject.close()

    assert len(rows_main) == 2
    assert len(rows_reject) == 1
    assert "failed_rule" in cols_reject
    assert "run_id" in cols_reject
    assert "load_date" in cols_reject


def test_pipeline_quarantine_uses_run_context_identity(tmp_path):
    import datetime as dt
    import sqlite3

    from framework.io.readers import CsvReader
    from framework.io.writers import QuarantineWriter, SqliteTruncateReloadWriter
    from framework.run.builder import Pipeline
    from framework.run.run_context import RunContext

    csv_file = tmp_path / "feed.csv"
    csv_file.write_text("case_ref,status\nBAD,open\n")

    context = RunContext(
        subject="cases",
        pipeline="ingest",
        run_date=dt.date(2026, 5, 29),
        execution_id="exec-1",
    )
    p = Pipeline("feed")
    r = p.read(CsvReader(csv_file), name="read")
    q = p.quarantine(
        SchemaValueRulePartitioner(RefCase),
        QuarantineWriter(tmp_path / "rejects.db", "rejects"),
        r,
        name="quarantine",
    )
    p.write(SqliteTruncateReloadWriter(tmp_path / "main.db", "feed"), q, name="write")
    p.run(context=context)

    con = sqlite3.connect(tmp_path / "rejects.db")
    try:
        row = con.execute(
            "SELECT run_id, logical_run_id, execution_id, load_date FROM rejects"
        ).fetchone()
    finally:
        con.close()

    assert row == (
        "cases/ingest:2026-05-29",
        "cases/ingest:2026-05-29",
        "exec-1",
        "2026-05-29",
    )


def test_pipeline_quarantine_is_idempotent_on_rerun(tmp_path):
    # Quarantine rejects are scoped by logical run id (delete-by-run_id + append):
    # re-running under the *same* logical run id replaces that run's rejects
    # rather than duplicating them, while a *different* id keeps its own alongside.
    import sqlite3

    from framework.io.readers import CsvReader
    from framework.io.writers import QuarantineWriter, SqliteTruncateReloadWriter
    from framework.run.builder import Pipeline
    from framework.run.run_context import RunContext

    csv_file = tmp_path / "feed.csv"
    csv_file.write_text("case_ref,status\nBAD,open\n")

    reject_db = tmp_path / "rejects.db"

    def run(logical_run_id: str):
        p = Pipeline("feed")
        r = p.read(CsvReader(csv_file), name="read")
        q = p.quarantine(
            SchemaValueRulePartitioner(RefCase),
            QuarantineWriter(reject_db, "rejects"),
            r,
            name="quarantine",
        )
        p.write(
            SqliteTruncateReloadWriter(tmp_path / "main.db", "feed"), q, name="write"
        )
        p.run(RunContext(pipeline="feed", logical_run_id=logical_run_id))

    run("run-A")
    run("run-A")  # same logical run id: replaces, not duplicates
    run("run-B")  # different logical run id: coexists

    con = sqlite3.connect(reject_db)
    rows = con.execute("SELECT run_id FROM rejects").fetchall()
    con.close()

    # The re-run replaced run-A's reject; run-B's sits alongside it.
    assert len(rows) == 2
    assert {r[0] for r in rows} == {"run-A", "run-B"}


def test_structural_breach_aborts_even_with_quarantine_configured(tmp_path):
    # A SchemaValidator (structural: missing column) must still abort the run —
    # quarantine only applies to value-rule breaches, not schema shape.
    from framework.core import SchemaValidator
    from framework.core.validators import ValidationError
    from framework.io.readers import CsvReader
    from framework.io.writers import QuarantineWriter, SqliteTruncateReloadWriter
    from framework.run.builder import Pipeline

    csv_file = tmp_path / "feed.csv"
    # Missing "status" column — structural breach.
    csv_file.write_text("case_ref\n123456789\n")

    p = Pipeline("feed")
    r = p.read(CsvReader(csv_file), name="read")
    v = p.validate(SchemaValidator(RefCase), r, name="schema-validator")
    q = p.quarantine(
        SchemaValueRulePartitioner(RefCase),
        QuarantineWriter(tmp_path / "rejects.db", "rejects"),
        v,
        name="quarantine",
    )
    p.write(SqliteTruncateReloadWriter(tmp_path / "main.db", "feed"), q, name="write")

    with pytest.raises(ValidationError):
        p.run()


def test_run_log_quarantine_step_records_rows_quarantined(tmp_path):
    # The quarantine step in the run log should record how many rows were
    # routed to the reject table so operators can audit without opening the db.
    import json

    from framework.io.readers import CsvReader
    from framework.io.writers import QuarantineWriter, SqliteTruncateReloadWriter
    from framework.run.builder import Pipeline
    from tools.observability.run_log import RunLog

    csv_file = tmp_path / "feed.csv"
    csv_file.write_text("case_ref,status\nBAD,open\n123456789,closed\n")

    log_file = tmp_path / "run.log"
    p = Pipeline("feed", run_log=RunLog(log_file))
    r = p.read(CsvReader(csv_file), name="read")
    q = p.quarantine(
        SchemaValueRulePartitioner(RefCase),
        QuarantineWriter(tmp_path / "rejects.db", "rejects"),
        r,
        name="quarantine",
    )
    p.write(SqliteTruncateReloadWriter(tmp_path / "main.db", "feed"), q, name="write")
    p.run()

    records = [json.loads(line) for line in log_file.read_text().splitlines()]
    quarantine_record = next(r for r in records if r["step"] == "quarantine")

    assert quarantine_record["rows_in"] == 2
    assert quarantine_record["rows_out"] == 1
    assert quarantine_record["rows_quarantined"] == 1

```
