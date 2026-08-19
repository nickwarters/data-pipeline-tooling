"""Eager pipeline steps — the default authoring model.

Every function here **does its work when you call it** and hands back an ordinary
:class:`~framework.core.dataset.Dataset`. A pipeline written with them is a plain
Python function, read and debugged top to bottom::

    def run(context):
        med = medallion(StoreRegistry(context.base_dir), "orders")
        data = read(CsvReader(SOURCE))        # <- breakpoint here; data is real
        data = coerce(OrderRow, data)         # <- step over; watch it change
        validate(SchemaValidator(OrderRow), data)
        write(med.silver.writer("orders", strategy), data)

That is the whole point. The deferred :class:`~framework.run.builder.Pipeline`
builds a graph first and executes it later, from the leaves backwards, which
means a breakpoint on an author's own line shows a ``TransformNode`` rather than
their data: to watch a frame change they have to breakpoint inside framework
code and know the walk order. These steps execute in the order they are written,
so the debugger an author already uses tells them the truth
([ADR-0027](../../docs/adr/0027-eager-steps-are-the-default-authoring-model.md)).

**Nothing observable is given up.** Each step emits exactly the same run-log
record the equivalent node would: one record per step, with its timing, row
counts either side, warn hits, data locations, and whether it committed. The
record's identity (``pipeline_run_id`` / ``logical_run_id``) comes from the
ambient :class:`~framework.run.run_context.RunContext` the runner sets around
``run(context)``, so replay, the run registry, freshness and ``cli status`` all
work exactly as before — the graph was never what produced them.

Run **outside** a runner — an author poking at a feed in a scratch file or a
PyCharm debug session — and there is simply no ambient context to record
against, so the steps quietly do their work and record nothing. Being able to
call :func:`read` on its own, with no ceremony, is a feature.
"""

from __future__ import annotations

import re
import time
from contextlib import contextmanager
from typing import Any, Iterator

from framework.core.dataset import Dataset
from framework.core.errors import ErrorCategory, PipelineError
from framework.core.protocols import Processor, Reader, Validator, Writer
from framework.core.validators import ValidationError
from framework.run.run_context import RunContext, current_context

__all__ = [
    "coerce",
    "enforce",
    "quarantine",
    "read",
    "step",
    "transform",
    "validate",
    "write",
]


class StepError(PipelineError):
    """Raised when an eager step is handed something it cannot work with."""

    category = ErrorCategory.CONFIG


# --- step naming -------------------------------------------------------------
#
# A step's name is what an operator reads in the run log and what ``cli runs``
# keys on, so it has to be stable and self-describing without the author having
# to invent one. ``read`` and ``write`` take the verb (there is normally one of
# each and "read"/"write" is what an operator expects to see); ``transform`` and
# ``validate`` take the component's own name, which is already the most
# informative word available -- ``Filter`` -> "filter", ``SchemaCoercion`` ->
# "schema_coercion". A name given explicitly always wins.

_CAMEL_BOUNDARY = re.compile(r"(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])")


def _snake(text: str) -> str:
    return _CAMEL_BOUNDARY.sub("_", text).lower()


def _component_name(component: object, fallback: str) -> str:
    """The most informative stable name for ``component``, else ``fallback``."""
    # A bound method (``obj.method``) describes itself best by its owner.
    owner = getattr(component, "__self__", None)
    if owner is not None:
        return _snake(type(owner).__name__)
    if isinstance(component, type):
        return _snake(component.__name__)
    own_name = getattr(component, "__name__", None)
    if own_name:
        # A lambda has a ``__name__`` of "<lambda>", which names nothing.
        return fallback if own_name == "<lambda>" else _snake(own_name)
    cls = type(component)
    if cls.__name__ in {"function", "builtin_function_or_method", "partial"}:
        return fallback
    return _snake(cls.__name__)


def _unique_step_name(context: RunContext | None, name: str) -> str:
    """``name``, suffixed if this run has already recorded a step by that name.

    Two coercions in one pipeline are ``schema_coercion`` and
    ``schema_coercion-2``, so every record still names exactly one step -- the
    promise the run log makes and the registry relies on.
    """
    if context is None:
        return name
    seen: dict[str, int] = getattr(context, "_eager_step_names", None)
    if seen is None:
        seen = {}
        # Private to the eager steps: the tally is per run attempt, and the
        # context is already exactly that scope.
        context._eager_step_names = seen
    count = seen.get(name, 0) + 1
    seen[name] = count
    return name if count == 1 else f"{name}-{count}"


# --- recording ---------------------------------------------------------------


@contextmanager
def step(
    name: str,
    *,
    rows_in: int | None = None,
    committed: bool = False,
) -> Iterator[Any]:
    """Record an arbitrary block of an author's own code as one run-log step.

    The escape hatch that keeps procedural code first-class: whatever a feed
    needs to do that no step covers -- calling a service, reconciling two frames
    by hand -- still shows up in the run log as a timed, named step rather than
    as an unexplained gap between two recorded ones::

        with step("fetch-reference-data") as metrics:
            reference = download(url)
            metrics.rows_out = len(reference)

    Yields the same mutable :class:`~tools.observability.run_log.StepMetrics` the
    deferred builder fills in, so ``rows_out`` / ``warn_hits`` are set the same
    way. Outside a run context it yields a throwaway tally and records nothing.
    """
    context = current_context()
    if context is None or context.run_log is None:
        from tools.observability.run_log import StepMetrics

        yield StepMetrics()
        return
    unique = _unique_step_name(context, name)
    with context.run_log.step(
        context.pipeline_run_id,
        context.label or (context.pipeline or ""),
        unique,
        rows_in=rows_in,
        committed=committed,
        logical_run_id=context.logical_run_id,
    ) as metrics:
        yield metrics


def _locations(component: object) -> list[dict[str, str]] | None:
    """What a component reported touching, copied so a later read can't mutate it."""
    locations = getattr(component, "data_locations", None)
    return list(locations) if locations else None


def _drain_retries(component: object) -> list[str]:
    """Retry warnings a Reader/Writer accumulated, for this step's warn hits."""
    attempts = getattr(component, "retry_attempts", None)
    return list(attempts) if attempts else []


@contextmanager
def _record(
    name: str,
    *,
    rows_in: int | None = None,
) -> Iterator[dict[str, Any]]:
    """Time one eager step and emit its single run-log record.

    Yields a mutable dict the caller fills in (``rows_out``, ``committed``,
    ``warn_hits``, ``data_locations``, ``rows_quarantined``, ``note``). One
    record per step, on both the success and the failure path -- the same
    contract :meth:`framework.run.builder.Node.execute` keeps for a node.
    """
    context = current_context()
    outcome: dict[str, Any] = {
        "rows_out": None,
        "rows_quarantined": None,
        "committed": False,
        "warn_hits": [],
        "data_locations": None,
        "note": None,
        "result": None,
    }
    if context is None or context.run_log is None:
        # No run above us: do the work, record nothing. An author debugging a
        # single step in a scratch file gets no ceremony and no run log.
        yield outcome
        return

    unique = _unique_step_name(context, name)
    pipeline = context.label or (context.pipeline or "")
    started = time.perf_counter()
    try:
        yield outcome
    except Exception as exc:
        context.run_log.record(
            context.pipeline_run_id,
            pipeline,
            unique,
            "error",
            logical_run_id=context.logical_run_id,
            rows_in=rows_in,
            duration=time.perf_counter() - started,
            errors=[str(exc)],
            error_category=getattr(exc, "category", None),
            warn_hits=outcome["warn_hits"] or None,
        )
        if context.dry_run and context.dry_run_report is not None:
            context.dry_run_report.observe(unique, "Step", note=f"FAILED: {exc}")
        raise
    context.run_log.record(
        context.pipeline_run_id,
        pipeline,
        unique,
        "ok",
        logical_run_id=context.logical_run_id,
        rows_in=rows_in,
        rows_out=outcome["rows_out"],
        rows_quarantined=outcome["rows_quarantined"],
        duration=time.perf_counter() - started,
        warn_hits=outcome["warn_hits"] or None,
        committed=bool(outcome["committed"]),
        data_locations=outcome["data_locations"],
    )
    if context.dry_run and context.dry_run_report is not None:
        context.dry_run_report.observe(
            unique, "Step", outcome["result"], note=outcome["note"]
        )


def _require_dataset(value: object, verb: str) -> Dataset:
    """Fail loudly, and early, when a step is handed something that isn't data.

    The commonest slip converting a deferred pipeline is leaving a builder node
    in place of its dataset, so the message says exactly that rather than
    surfacing as an ``AttributeError`` three steps later.
    """
    if isinstance(value, Dataset):
        return value
    raise StepError(
        f"{verb}() expects a Dataset, got {type(value).__name__}. "
        "Eager steps pass the data itself, not a builder node: write "
        "`data = transform(processor, data)`, not `p.transform(...)`."
    )


# --- the steps ---------------------------------------------------------------


def read(reader: Reader, *, name: str | None = None) -> Dataset:
    """Read a source now and return its rows.

    Records one ``read`` step with the row count and whatever the Reader
    reported touching, so the run log names the file or table the rows came from.
    """
    step_name = name or "read"
    with _record(step_name) as outcome:
        try:
            dataset = reader.read()
        finally:
            outcome["warn_hits"].extend(_drain_retries(reader))
        outcome["rows_out"] = len(dataset)
        outcome["data_locations"] = _locations(reader)
        outcome["result"] = dataset
    return dataset


def transform(
    processor: Processor, dataset: Dataset, *, name: str | None = None
) -> Dataset:
    """Apply ``processor`` to ``dataset`` now and return the result.

    The argument order matches the deferred builder's ``p.transform(processor,
    node)``, so converting a pipeline is mechanical: drop the ``p.``, pass the
    data instead of the node, drop the ``name=``.
    """
    dataset = _require_dataset(dataset, "transform")
    step_name = name or _component_name(processor, "transform")
    with _record(step_name, rows_in=len(dataset)) as outcome:
        result = processor(dataset)
        outcome["rows_out"] = len(result) if isinstance(result, Dataset) else None
        outcome["result"] = result
    return result


def validate(
    validator: Validator,
    dataset: Dataset,
    *,
    name: str | None = None,
    severity: str = "error",
) -> Dataset:
    """Check ``dataset`` now; return it unchanged so the step can be chained.

    A validator's contract is raise-or-nothing. At ``severity="warn"`` a
    :class:`ValidationError` is downgraded to a warn hit on the record and the
    run continues; anything else -- a typo'd column, a half-written validator --
    propagates with its traceback, so a run never reports success for a check
    that did not actually happen.
    """
    dataset = _require_dataset(dataset, "validate")
    step_name = name or _component_name(validator, "validate")
    with _record(step_name, rows_in=len(dataset)) as outcome:
        try:
            validator.validate(dataset)
        except ValidationError as exc:
            if severity != "warn":
                raise
            outcome["warn_hits"].append(f"{step_name}: {exc}")
        outcome["rows_out"] = len(dataset)
        outcome["result"] = dataset
    return dataset


def write(writer: Writer, dataset: Dataset, *, name: str | None = None) -> Dataset:
    """Write ``dataset`` now; return it unchanged so the step can be chained.

    Under ``RunContext(dry_run=True)`` the commit is skipped and the intent is
    previewed instead, exactly as the deferred write node does -- so ``cli run
    --dry-run`` stays safe against an eager pipeline.
    """
    dataset = _require_dataset(dataset, "write")
    step_name = name or "write"
    context = current_context()
    with _record(step_name, rows_in=len(dataset)) as outcome:
        outcome["rows_out"] = len(dataset)
        outcome["result"] = dataset
        if context is not None and context.dry_run:
            outcome["note"] = f"would write {len(dataset)} row(s)"
            return dataset
        try:
            writer.write(dataset)
        finally:
            outcome["warn_hits"].extend(_drain_retries(writer))
        outcome["committed"] = True
        outcome["data_locations"] = _locations(writer)
    return dataset


def quarantine(
    partitioner: Any,
    reject_writer: Writer,
    dataset: Dataset,
    *,
    name: str | None = None,
) -> Dataset:
    """Split ``dataset`` now, write the rejects, and return the rows that passed.

    The rejects are stamped with the run's ``logical_run_id`` and ``load_date``
    -- the two columns the quarantine table is keyed and dated by. The attempt
    behind the row is not stamped here: the ``QuarantineWriter`` sets the
    reserved provenance column, as every table-backed Writer does.
    """
    dataset = _require_dataset(dataset, "quarantine")
    step_name = name or "quarantine"
    context = current_context()
    with _record(step_name, rows_in=len(dataset)) as outcome:
        good, rejected = partitioner.partition(dataset)
        outcome["rows_quarantined"] = len(rejected)
        outcome["rows_out"] = len(good)
        outcome["result"] = good
        if context is not None and context.dry_run:
            outcome["note"] = f"would quarantine {len(rejected)} row(s)"
            return good
        if len(rejected) > 0:
            frame = rejected.to_pandas()
            if context is not None:
                frame["logical_run_id"] = context.logical_run_id
                frame["load_date"] = context.load_date
            reject_writer.write(Dataset.from_pandas(frame))
            outcome["committed"] = True
    return good


def coerce(schema: type, dataset: Dataset, *, name: str | None = None) -> Dataset:
    """Cast ``dataset``'s declared columns to the dtypes ``schema`` declares.

    Sugar for ``transform(SchemaCoercion(schema), dataset)`` -- the coerce half
    of the schema adapter, imported for you so a feed needs one import fewer.
    """
    from framework.transform.coercion import SchemaCoercion

    return transform(SchemaCoercion(schema), dataset, name=name or "coerce")


def enforce(
    schema: type,
    dataset: Dataset,
    *,
    reject_writer: Writer | None = None,
) -> Dataset:
    """Coerce to ``schema``, optionally quarantine value-rule breaches, then check it.

    The three-step sequence every silver hop repeats, in the order that makes it
    correct: coerce the dtypes storage lost, route value-rule breaches to
    quarantine so the good rows still land, then validate the declared schema.
    Getting that order wrong is a real and easy mistake, so it is made once here.

    Each part still records its **own** step -- ``coerce``, ``quarantine``,
    ``schema_validator`` -- so the run log and the debugger show the same three
    operations they would if they had been written out by hand. It is shorthand,
    not a black box; write the three calls yourself whenever that reads better.
    """
    from framework.core.schema import SchemaValidator
    from framework.transform.quarantine import SchemaValueRulePartitioner

    dataset = coerce(schema, dataset)
    if reject_writer is not None:
        dataset = quarantine(SchemaValueRulePartitioner(schema), reject_writer, dataset)
    return validate(SchemaValidator(schema), dataset)
