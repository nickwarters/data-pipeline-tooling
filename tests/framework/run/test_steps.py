"""Tests for the eager pipeline steps (``framework.run.steps``).

The steps exist so a pipeline executes where it is written — the property the
deferred builder cannot offer — while emitting the *identical* run-log records
the builder does. Both halves are tested here: what each step returns (so an
author's next line gets real data), and what it records (so the run registry,
freshness and ``cli status`` are unaffected by which model a feed was written
in).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated

import pytest

from framework.core import (
    ColumnValidator,
    Dataset,
    Range,
    SchemaValidator,
    ValidationError,
)
from framework.run import (
    Pipeline,
    RunContext,
    StepError,
    coerce,
    enforce,
    explain,
    quarantine,
    read,
    step,
    transform,
    validate,
    write,
    write_trace,
)
from framework.run.run_context import active_context
from framework.transform import Filter, SchemaValueRulePartitioner
from tests.framework_testing import RecordingRunLog, RecordingWriter, given_rows


@dataclass
class Row:
    record_id: str
    amount: int


@dataclass
class GatedRow:
    record_id: str
    amount: Annotated[int, Range(minimum=0)]


def _context(**kwargs) -> tuple[RunContext, RecordingRunLog]:
    run_log = RecordingRunLog()
    return RunContext(pipeline="demo", run_log=run_log, **kwargs), run_log


def _steps(run_log: RecordingRunLog) -> list[str]:
    return [record["step"] for record in run_log.records]


# --- what the steps return ---------------------------------------------------


def test_each_step_returns_the_data_so_the_next_line_can_use_it():
    # The whole point of the eager model: the value on the left of the `=` is
    # the rows themselves, at that line, not a node to be executed later.
    context, _ = _context()
    with active_context(context):
        data = read(given_rows([{"record_id": "a", "amount": "1"}]))
        assert isinstance(data, Dataset)
        assert len(data) == 1

        coerced = coerce(Row, data)
        assert coerced.dtypes["amount"].lower().startswith("int")

        filtered = transform(Filter(lambda row: row["amount"] > 0), coerced)
        assert len(filtered) == 1

        # validate and write are pass-throughs, so a chain reads top to bottom.
        assert validate(SchemaValidator(Row), filtered) is filtered
        assert write(RecordingWriter(), filtered) is filtered


def test_steps_run_with_no_run_context_at_all():
    # An author poking at a feed in a scratch file or a debugger has no runner
    # above them. That has to work, and record nothing, or the debugging story
    # the eager model exists for does not survive contact with a scratch file.
    data = read(given_rows([{"record_id": "a", "amount": 1}]))
    assert len(data) == 1
    assert len(transform(Filter(lambda row: True), data)) == 1


def _stack(*datasets: Dataset) -> Dataset:
    """A fan-in: concatenate every input, the shape ``retail_analytics`` uses."""
    import pandas as pd

    return Dataset.from_pandas(
        pd.concat([d.to_pandas() for d in datasets], ignore_index=True)
    )


def test_a_transform_takes_as_many_datasets_as_the_builder_node_did():
    # ``p.transform(func, a, b, name=...)`` called ``func(a, b)``; so does this.
    # A fan-in written for one model works unchanged in the other, which is what
    # keeps notifications' join-case and retail_analytics' three-way stack
    # expressible without dropping out of the steps.
    left = given_rows([{"record_id": "a", "amount": 1}]).read()
    right = given_rows([{"record_id": "b", "amount": 2}]).read()
    third = given_rows([{"record_id": "c", "amount": 3}]).read()

    stacked = transform(_stack, left, right, third)

    assert [row["record_id"] for row in stacked.to_pandas().to_dict("records")] == [
        "a",
        "b",
        "c",
    ]


def test_a_fan_in_counts_rows_in_from_its_first_dataset():
    # The builder's TransformNode took datasets[0] as "before"; a later input is
    # the reference side, not the flow, so counting it would misreport the step.
    context, run_log = _context()
    flow = given_rows([{"record_id": "a", "amount": 1}]).read()
    reference = given_rows(
        [{"record_id": "b", "amount": 2}, {"record_id": "c", "amount": 3}]
    ).read()

    with active_context(context):
        transform(_stack, flow, reference, name="stack")

    [record] = run_log.records
    assert record["step"] == "stack"
    assert record["rows_in"] == 1  # the flow, not the 2-row reference side
    assert record["rows_out"] == 3


def test_a_transform_given_no_dataset_at_all_says_so():
    with pytest.raises(StepError, match="needs at least one Dataset"):
        transform(_stack)


def test_a_fan_in_refuses_a_builder_node_in_any_position():
    # The node check has to cover the reference side too, or a half-converted
    # fan-in fails inside the processor rather than at the step.
    pipeline = Pipeline("p")
    node = pipeline.read(given_rows([{"record_id": "a"}]), name="read")
    data = given_rows([{"record_id": "a", "amount": 1}]).read()
    with pytest.raises(StepError, match="expects a Dataset, got ReadNode"):
        transform(_stack, data, node)


def test_passing_a_builder_node_instead_of_data_is_refused_by_name():
    # The commonest slip when converting a deferred pipeline. It must fail at
    # the step with an instruction, not three lines later as an AttributeError.
    pipeline = Pipeline("p")
    node = pipeline.read(given_rows([{"record_id": "a"}]), name="read")
    with pytest.raises(StepError, match="expects a Dataset, got ReadNode"):
        transform(Filter(lambda row: True), node)


# --- what the steps record ---------------------------------------------------


def test_every_step_records_exactly_one_record_named_for_its_component():
    context, run_log = _context()
    writer = RecordingWriter()
    with active_context(context):
        data = read(given_rows([{"record_id": "a", "amount": 1}]))
        data = coerce(Row, data)
        data = transform(Filter(lambda row: True), data)
        validate(SchemaValidator(Row), data)
        write(writer, data)

    # read/write take the verb an operator expects; transform and validate take
    # the component's own name, which is the most informative word available.
    assert _steps(run_log) == [
        "read",
        "coerce",
        "filter",
        "schema_validator",
        "write",
    ]
    assert all(record["status"] == "ok" for record in run_log.records)


def test_a_step_records_the_row_counts_either_side():
    context, run_log = _context()
    with active_context(context):
        data = read(given_rows([{"record_id": "a"}, {"record_id": "b"}]))
        transform(Filter(lambda row: row["record_id"] == "a"), data)

    by_step = {record["step"]: record for record in run_log.records}
    assert by_step["read"]["rows_out"] == 2
    assert by_step["filter"]["rows_in"] == 2
    assert by_step["filter"]["rows_out"] == 1


def test_only_a_write_reports_that_it_committed():
    context, run_log = _context()
    with active_context(context):
        data = read(given_rows([{"record_id": "a"}]))
        write(RecordingWriter(), data)

    by_step = {record["step"]: record for record in run_log.records}
    assert by_step["write"]["committed"] is True
    assert by_step["read"]["committed"] is False


def test_repeated_step_names_are_suffixed_so_each_record_names_one_step():
    context, run_log = _context()
    with active_context(context):
        data = read(given_rows([{"record_id": "a"}]))
        data = transform(Filter(lambda row: True), data)
        data = transform(Filter(lambda row: True), data)
        transform(Filter(lambda row: True), data)

    assert _steps(run_log) == ["read", "filter", "filter-2", "filter-3"]


def test_an_explicit_name_wins_over_the_derived_one():
    context, run_log = _context()
    with active_context(context):
        read(given_rows([{"record_id": "a"}]), name="read-the-feed")
    assert _steps(run_log) == ["read-the-feed"]


def test_records_carry_the_runs_identity_so_the_registry_can_correlate_them():
    context, run_log = _context()
    with active_context(context):
        read(given_rows([{"record_id": "a"}]))

    record = run_log.records[0]
    assert record["pipeline_run_id"] == context.pipeline_run_id
    assert record["logical_run_id"] == context.logical_run_id
    assert record["pipeline"] == context.label


def test_a_failing_step_records_an_error_and_re_raises():
    context, run_log = _context()
    with pytest.raises(ValidationError):
        with active_context(context):
            data = read(given_rows([{"wrong_column": "x"}]))
            validate(ColumnValidator(["record_id"]), data)

    failed = run_log.records[-1]
    assert failed["step"] == "column_validator"
    assert failed["status"] == "error"
    # The triage category travels, so an operator can route the failure.
    assert failed["error_category"] == "data"


# --- validate ----------------------------------------------------------------


def test_warn_severity_downgrades_a_breach_to_a_warn_hit_and_continues():
    context, run_log = _context()
    with active_context(context):
        data = read(given_rows([{"wrong_column": "x"}]))
        returned = validate(ColumnValidator(["record_id"]), data, severity="warn")

    assert returned is data
    record = run_log.records[-1]
    assert record["status"] == "ok"
    assert any("missing required column" in hit for hit in record["warn_hits"])


def test_a_non_validation_failure_is_never_downgraded_by_warn_severity():
    # A validator that breaks for any *other* reason is a bug, not a data
    # breach: it must not be swallowed into a warn hit, or a run reports
    # success for a check that never actually ran.
    class BrokenValidator:
        def validate(self, dataset):
            raise KeyError("typo'd column name")

    context, _ = _context()
    with pytest.raises(KeyError):
        with active_context(context):
            data = read(given_rows([{"record_id": "a"}]))
            validate(BrokenValidator(), data, severity="warn")


# --- quarantine and enforce --------------------------------------------------


def test_quarantine_routes_breaches_and_returns_only_the_good_rows():
    context, run_log = _context()
    rejects = RecordingWriter()
    with active_context(context):
        data = read(
            given_rows(
                [{"record_id": "a", "amount": 5}, {"record_id": "b", "amount": -1}]
            )
        )
        good = quarantine(SchemaValueRulePartitioner(GatedRow), rejects, data)

    assert len(good) == 1
    assert len(rejects.writes) == 1
    record = [r for r in run_log.records if r["step"] == "quarantine"][0]
    assert record["rows_quarantined"] == 1
    assert record["rows_out"] == 1
    assert record["committed"] is True


def test_quarantined_rows_are_stamped_with_the_runs_keys():
    context, _ = _context()
    rejects = RecordingWriter()
    with active_context(context):
        data = read(given_rows([{"record_id": "b", "amount": -1}]))
        quarantine(SchemaValueRulePartitioner(GatedRow), rejects, data)

    written = rejects.writes[0]
    assert "logical_run_id" in written.columns
    assert "load_date" in written.columns
    # The rule that rejected the row travels with it, so quarantine is triageable.
    assert "failed_rule" in written.columns


def test_enforce_coerces_then_quarantines_then_validates_as_three_steps():
    # The order is load-bearing — coercing after the value check would test the
    # wrong values — and each part still records its own step, so `enforce` is
    # shorthand rather than a black box.
    context, run_log = _context()
    rejects = RecordingWriter()
    with active_context(context):
        data = read(
            given_rows(
                [
                    {"record_id": "a", "amount": "5"},
                    {"record_id": "b", "amount": "-1"},
                ]
            )
        )
        good = enforce(GatedRow, data, reject_writer=rejects)

    assert _steps(run_log) == ["read", "coerce", "quarantine", "schema_validator"]
    assert len(good) == 1


def test_enforce_without_a_reject_writer_is_coerce_then_validate():
    context, run_log = _context()
    with active_context(context):
        data = read(given_rows([{"record_id": "a", "amount": "5"}]))
        enforce(Row, data)

    assert _steps(run_log) == ["read", "coerce", "schema_validator"]


# --- dry run -----------------------------------------------------------------


def test_a_dry_run_skips_every_commit_but_still_reads_and_checks():
    context, run_log = _context(dry_run=True)
    writer = RecordingWriter()
    rejects = RecordingWriter()
    with active_context(context):
        data = read(given_rows([{"record_id": "b", "amount": -1}]))
        data = quarantine(SchemaValueRulePartitioner(GatedRow), rejects, data)
        write(writer, data)

    assert writer.writes == []
    assert rejects.writes == []
    assert all(record["committed"] is False for record in run_log.records)


def test_a_dry_run_previews_the_shape_of_every_step_and_the_skipped_intent():
    context, _ = _context(dry_run=True)
    with active_context(context):
        data = read(given_rows([{"record_id": "a", "amount": 1}]))
        write(RecordingWriter(), data)

    report = context.dry_run_report
    assert [preview.name for preview in report.steps] == ["read", "write"]
    # The preview carries the real shape, because the read really happened.
    assert report.step("read").columns == ["record_id", "amount"]
    assert report.step("write").note == "would write 1 row(s)"


# --- the custom step escape hatch --------------------------------------------


def test_an_authors_own_block_can_be_recorded_as_one_step():
    context, run_log = _context()
    with active_context(context):
        with step("fetch-reference-data") as metrics:
            metrics.rows_out = 42

    record = run_log.records[-1]
    assert record["step"] == "fetch-reference-data"
    assert record["rows_out"] == 42
    assert record["status"] == "ok"


def test_a_custom_step_that_raises_is_recorded_as_an_error():
    context, run_log = _context()
    with pytest.raises(RuntimeError):
        with active_context(context):
            with step("fetch-reference-data"):
                raise RuntimeError("the service was down")

    record = run_log.records[-1]
    assert record["step"] == "fetch-reference-data"
    assert record["status"] == "error"


# --- interoperating with the deferred builder --------------------------------


def test_eager_steps_and_a_deferred_pipeline_share_one_runs_identity():
    # A feed part-converted to eager steps still reports as one run: the same
    # pipeline_run_id across both models, so nothing orphans in the registry
    # while the migration is half done.
    context, run_log = _context()
    with active_context(context):
        read(given_rows([{"record_id": "a"}]))
        pipeline = Pipeline("nested")
        node = pipeline.read(given_rows([{"record_id": "b"}]), name="read")
        pipeline.write(RecordingWriter(), node, name="write")
        pipeline.run()

    run_ids = {record["pipeline_run_id"] for record in run_log.records}
    assert len(run_ids) == 1
    assert run_ids == {context.pipeline_run_id}


# --- telling repeated steps apart -------------------------------------------


def test_repeated_steps_are_told_apart_by_the_name_their_caller_gives_them():
    """The reason a feed with 20 reads is still readable.

    There is no grouping scope to open: a step that runs many times over is
    handed a name carrying what it is building. Left to default, the framework
    still keeps every record naming exactly one step -- ``read``, ``read-2`` --
    but only the author knows which list the second one polled, which is why a
    feed that repeats a shape names its steps and a feed that does not need not.
    """
    context, run_log = _context()
    with active_context(context):
        for case_type in ("claims", "complaints"):
            rows = [{"record_id": "a", "amount": 1}]
            data = read(given_rows(rows), name=f"silver:{case_type}:read")
            write(RecordingWriter(), data, name=f"silver:{case_type}:write")
        read(given_rows([{"record_id": "b", "amount": 2}]))
        read(given_rows([{"record_id": "c", "amount": 3}]))

    assert [(record["pipeline"], record["step"]) for record in run_log.records] == [
        ("demo", "silver:claims:read"),
        ("demo", "silver:claims:write"),
        ("demo", "silver:complaints:read"),
        ("demo", "silver:complaints:write"),
        ("demo", "read"),
        ("demo", "read-2"),
    ]


def test_enforce_prefixes_all_three_of_its_steps_with_the_name_it_is_given():
    # Otherwise a feed enforcing the same schema per list reads coerce,
    # coerce-2, ... and an operator cannot tell whose value rule was breached.
    context, run_log = _context()
    rejects = RecordingWriter()
    with active_context(context):
        data = read(given_rows([{"record_id": "a", "amount": "5"}]), name="claims:read")
        enforce(GatedRow, data, reject_writer=rejects, name="claims")

    assert _steps(run_log) == [
        "claims:read",
        "claims:coerce",
        "claims:quarantine",
        "claims:schema_validator",
    ]


# --- the row trace ------------------------------------------------------------


def _gate(capacity: int):
    """A stage that keeps the first ``capacity`` rows, named for the trace."""

    def gate(dataset: Dataset) -> Dataset:
        return Dataset.from_pandas(dataset.to_pandas().head(capacity))

    gate.trace_role = "gate"
    gate.trace_name = "capacity"
    return gate


def test_explain_records_which_stage_excluded_each_row():
    context, run_log = _context()
    trace_writer = RecordingWriter()
    with active_context(context):
        with explain("record_id") as trace:
            data = read(
                given_rows(
                    [
                        {"record_id": "a", "amount": 3},
                        {"record_id": "b", "amount": 2},
                        {"record_id": "c", "amount": 1},
                    ]
                )
            )
            data = transform(_gate(2), data, name="hopper")
        write_trace(trace_writer, trace, data)

    verdicts = {
        row["record_id"]: row
        for row in trace_writer.writes[0].to_pandas().to_dict("records")
    }
    assert verdicts["a"]["verdict"] == "selected"
    assert verdicts["c"]["verdict"] == "excluded"
    assert "capacity" in verdicts["c"]["reason"]

    # The step's counts are the trace's question, not this step's own inputs.
    [record] = [r for r in run_log.records if r["step"] == "explain"]
    assert (record["rows_in"], record["rows_out"], record["rows_excluded"]) == (3, 2, 1)
    assert record["committed"] is True


def test_write_trace_returns_the_survivors_so_the_next_line_can_write_them():
    with explain("record_id") as trace:
        data = read(given_rows([{"record_id": "a", "amount": 1}]))
    survivors = write_trace(RecordingWriter(), trace, data)

    assert survivors is data


def test_a_dry_run_builds_the_trace_and_commits_nothing():
    context, _ = _context(dry_run=True)
    trace_writer = RecordingWriter()
    with active_context(context):
        with explain("record_id") as trace:
            data = read(given_rows([{"record_id": "a", "amount": 1}]))
        write_trace(trace_writer, trace, data)

    assert trace_writer.writes == []
    assert context.dry_run_report.step("explain").note == (
        "would write trace: 1 row(s) (1 selected, 0 excluded)"
    )


def test_a_step_outside_an_explain_block_traces_nothing():
    # The trace is scoped to its block, so a later transform cannot append to it.
    with explain("record_id") as trace:
        data = read(given_rows([{"record_id": "a", "amount": 1}]))
    transform(_gate(0), data, name="hopper")

    assert trace.selected == 1
    assert trace.excluded == 0


# --- what a dry run calls each step -------------------------------------------


def test_a_preview_names_each_steps_kind_as_the_builder_does():
    context, _ = _context(dry_run=True)
    rejects = RecordingWriter()
    with active_context(context):
        data = read(given_rows([{"record_id": "a", "amount": 1}]))
        data = transform(Filter(lambda row: True), data)
        data = quarantine(SchemaValueRulePartitioner(GatedRow), rejects, data)
        validate(ColumnValidator(["record_id"]), data)
        write(RecordingWriter(), data)

    assert [preview.node_type for preview in context.dry_run_report.steps] == [
        "Read",
        "Transform",
        "Quarantine",
        "Validate",
        "Write",
    ]
