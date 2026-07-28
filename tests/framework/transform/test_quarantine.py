"""Quarantine row-level value-rule partitioning and pipeline integration.

Tests the opt-in quarantine path: value-rule-failing rows are routed to a
reject table; good rows proceed. Structural breaches (missing columns, wrong
dtypes) still abort via SchemaValidator; the abort-vs-quarantine boundary is
the key invariant.
"""

from __future__ import annotations

from dataclasses import dataclass, make_dataclass
from typing import Annotated

import pandas as pd
import pytest

from framework.core import Length, OneOf, Pattern, RowCheck, Unique, row_checks
from framework.core.dataset import Dataset
from framework.transform.quarantine import SchemaValueRulePartitioner
from tests.framework_testing import create_table


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


class StartsWithBad:
    """A value rule implementing the protocol and inheriting nothing.

    The ``ValueRule`` contract is structural, so quarantine must keep working
    for a rule an application wrote itself, with no framework base class in
    sight.
    """

    def violating_mask(self, series: "pd.Series") -> "pd.Series":
        return pd.Series(
            [bool(v is not None and str(v).startswith("bad")) for v in series],
            index=series.index,
        )

    def check(self, series: "pd.Series") -> str | None:
        breaches = series[self.violating_mask(series).to_numpy()]
        return None if breaches.empty else "is a bad value"


@dataclass
class HandRolledRuleCase:
    code: Annotated[str, StartsWithBad()]


def test_partitioner_routes_rows_failing_a_hand_rolled_rule():
    ds = _dataset(code=["ok", "bad-one", "fine"])

    good, rejected = SchemaValueRulePartitioner(HandRolledRuleCase).partition(ds)

    assert list(good.to_pandas()["code"]) == ["ok", "fine"]
    assert list(rejected.to_pandas()["code"]) == ["bad-one"]
    assert list(rejected.to_pandas()["failed_rule"]) == ["column 'code' is a bad value"]


@dataclass
class CodeCase:
    code: Annotated[str, OneOf("A", "B")]


def test_reject_reason_names_only_the_rules_expectation_not_other_rows_values():
    # The ticket's reproduction: three rows breach OneOf('A', 'B'). Each row's
    # reason must describe the *rule*, never sample values that belong to the
    # other rejected rows.
    ds = _dataset(code=pd.Series(["A", "X", "B", "Y", "Z"], dtype="string"))

    _, rejected = SchemaValueRulePartitioner(CodeCase).partition(ds)

    frame = rejected.to_pandas()
    assert list(frame["code"]) == ["X", "Y", "Z"]
    for value, reason in zip(frame["code"], frame["failed_rule"]):
        others = {"X", "Y", "Z"} - {value}
        assert not any(f"'{other}'" in reason for other in others), reason
        assert "outside {'A', 'B'}" in reason


class CountingRule:
    """A hand-rolled rule that records how often each method is called."""

    def __init__(self) -> None:
        self.mask_calls = 0
        self.check_calls = 0

    def violating_mask(self, series: "pd.Series") -> "pd.Series":
        self.mask_calls += 1
        return pd.Series([str(v).startswith("bad") for v in series], index=series.index)

    def check(self, series: "pd.Series") -> str | None:
        self.check_calls += 1
        breaches = series[self.violating_mask(series).to_numpy()]
        return None if breaches.empty else "is a bad value"


def _counting_schema(rule: CountingRule) -> type:
    # make_dataclass so the rule instance lands in the annotation as an object
    # (a source-level annotation would be a postponed string naming a local).
    return make_dataclass("CountedCase", [("code", Annotated[str, rule])])


def test_rule_phrase_is_computed_once_per_rule_not_once_per_violating_row():
    # The phrase belongs to the rule, so it must be derived once before the row
    # loop. Cost stays O(rows x rules) rather than O(violating rows x rules x rows).
    rule = CountingRule()
    schema = _counting_schema(rule)
    ds = _dataset(code=pd.Series(["bad-1", "bad-2", "bad-3", "ok"], dtype="string"))

    partitioner = SchemaValueRulePartitioner(schema)
    rule.mask_calls = rule.check_calls = 0
    partitioner.partition(ds)

    # One mask for the routing, at most one phrase derivation for the label.
    assert rule.check_calls <= 1
    assert rule.mask_calls <= 2


def test_quarantine_cost_does_not_grow_with_the_number_of_violating_rows():
    # A benchmark-style guard: doubling the violating rows must not increase the
    # number of times the rule is consulted.
    def consultations(bad_rows: int) -> int:
        rule = CountingRule()
        schema = _counting_schema(rule)
        values = [f"bad-{i}" for i in range(bad_rows)] + ["ok"]
        partitioner = SchemaValueRulePartitioner(schema)
        rule.mask_calls = rule.check_calls = 0
        partitioner.partition(_dataset(code=pd.Series(values, dtype="string")))
        return rule.mask_calls + rule.check_calls

    assert consultations(50) == consultations(100)


def test_partitioner_routes_by_position_on_a_duplicated_index():
    # Concatenating frames behind the Dataset seam repeats index labels. Routing
    # by label would merge two distinct rows' reasons and select the wrong rows.
    frame = pd.DataFrame({"code": pd.Series(["A", "X", "B", "Y"], dtype="string")})
    frame.index = [0, 0, 1, 1]  # set after construction: no reindex-by-label
    good, rejected = SchemaValueRulePartitioner(CodeCase).partition(
        Dataset.from_pandas(frame)
    )

    assert list(good.to_pandas()["code"]) == ["A", "B"]
    assert list(rejected.to_pandas()["code"]) == ["X", "Y"]
    assert len(rejected.to_pandas()["failed_rule"]) == 2


def test_partitioner_routes_by_position_on_a_string_index():
    frame = pd.DataFrame({"code": pd.Series(["A", "X", "B"], dtype="string")})
    frame.index = ["r1", "r2", "r3"]
    good, rejected = SchemaValueRulePartitioner(CodeCase).partition(
        Dataset.from_pandas(frame)
    )

    assert list(good.to_pandas()["code"]) == ["A", "B"]
    assert list(rejected.to_pandas()["code"]) == ["X"]


def test_partitioner_routes_by_position_on_a_non_monotonic_integer_index():
    # Labels [5, 3, 7, 1] make positional and label indexing disagree.
    frame = pd.DataFrame({"code": pd.Series(["A", "X", "B", "Y"], dtype="string")})
    frame.index = [5, 3, 7, 1]
    good, rejected = SchemaValueRulePartitioner(CodeCase).partition(
        Dataset.from_pandas(frame)
    )

    assert list(good.to_pandas()["code"]) == ["A", "B"]
    assert list(rejected.to_pandas()["code"]) == ["X", "Y"]


def test_partitioner_row_check_reasons_follow_the_row_on_a_duplicated_index():
    # The horizontal path must route positionally too: only the breaching row
    # carries the check's phrase, even when it shares a label with a good row.
    frame = pd.DataFrame(
        {
            "amount": pd.Series([10, 99, 30], dtype="int64"),
            "limit": pd.Series([100, 50, 100], dtype="int64"),
        }
    )
    frame.index = [7, 7, 7]
    good, rejected = SchemaValueRulePartitioner(ExposureCase).partition(
        Dataset.from_pandas(frame)
    )

    assert list(good.to_pandas()["amount"]) == [10, 30]
    assert list(rejected.to_pandas()["amount"]) == [99]
    assert list(rejected.to_pandas()["failed_rule"]) == ["amount exceeds limit"]


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
    create_table(
        main_db,
        "feed",
        Dataset.from_pandas(pd.DataFrame({"case_ref": [], "status": []})),
    )

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
    assert "logical_run_id" in cols_reject
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
    create_table(
        tmp_path / "main.db",
        "feed",
        Dataset.from_pandas(pd.DataFrame({"case_ref": [], "status": []})),
    )

    context = RunContext(
        subject="cases",
        pipeline="ingest",
        run_date=dt.date(2026, 5, 29),
        pipeline_run_id="exec-1",
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
            "SELECT logical_run_id, pipeline_run_id, load_date FROM rejects"
        ).fetchone()
    finally:
        con.close()

    assert row == (
        "cases/ingest:2026-05-29",
        "exec-1",
        "2026-05-29",
    )


def test_pipeline_quarantine_is_idempotent_on_rerun(tmp_path):
    # Quarantine rejects are scoped by logical run id (delete-by-logical-run + append):
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
    create_table(
        tmp_path / "main.db",
        "feed",
        Dataset.from_pandas(pd.DataFrame({"case_ref": [], "status": []})),
    )

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
    rows = con.execute("SELECT logical_run_id FROM rejects").fetchall()
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
    create_table(
        tmp_path / "main.db",
        "feed",
        Dataset.from_pandas(pd.DataFrame({"case_ref": [], "status": []})),
    )
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
