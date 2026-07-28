"""The standard medallion hop recipes: source -> raw and raw -> silver.

Every feed shares the same two opening hops. Landing a source faithfully and
then canonicalising it into silver is not a per-feed decision — it is the
medallion's own shape — so it is composed once here rather than re-emitted by
each feed (and by the scaffold's code generator) as a copy.

A recipe is **composition, not inheritance**: it returns a plain, not-yet-run
:class:`~framework.run.Pipeline` that the caller owns. There is no hook the
framework calls back into and nothing to subclass, so a feed that needs to
diverge inlines the recipe's body into its own builder and edits it. That keeps
a scaffolded feed fully editable while giving the standard hop one place to
evolve: adding a step to the standard raw hop is a one-line change here, and
every feed composed from the recipe inherits it.

The recipes take the hop's **ports** (a Reader and a Writer) rather than a
medallion profile, for two reasons: the source end of the raw hop is not a
medallion layer at all, and injecting the ports is what lets a feed's test drive
the real hop in memory against a recording writer. Callers wire the medallion
layer Writers themselves — see :func:`tools.medallion.medallion`.

These live beside the medallion profile rather than in ``framework``: raw and
silver are application vocabulary, and the framework is kept domain-free.

Usage::

    from tools.recipes import raw_to_silver, source_to_raw

    def raw_builder(reader, writer, run_log=None):
        return source_to_raw(
            reader,
            writer,
            expected_columns=["case_ref", "adviser"],
            name="cases:raw",
            run_log=run_log,
        )
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence

from framework.core import ColumnValidator, Reader, SchemaValidator, Writer
from framework.run import Pipeline, RunLog
from framework.transform import Rename, SchemaCoercion, SchemaValueRulePartitioner

# The standard hop names, so a run log reads the same across every feed that
# composes a recipe.
DEFAULT_RAW_NAME = "source-to-raw"
DEFAULT_SILVER_NAME = "raw-to-silver"


def source_to_raw(
    reader: Reader,
    writer: Writer,
    *,
    expected_columns: Sequence[str] | None = None,
    name: str = DEFAULT_RAW_NAME,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Compose the standard raw hop: land the source faithfully, gate its shape.

    Raw is deliberately un-renamed and un-coerced — it is the diagnosable,
    re-runnable landing zone, so the source's own vocabulary and dtypes survive
    it. The only check is structural: that the columns we were promised arrived,
    named as the *source* names them. Pass ``expected_columns=None`` to land with
    no gate at all.
    """
    p = Pipeline(name, run_log=run_log)
    node = p.read(reader, name="read")
    if expected_columns:
        node = p.validate(ColumnValidator(list(expected_columns)), node, name="columns")
    p.write(writer, node, name="write")
    return p


def raw_to_silver(
    reader: Reader,
    writer: Writer,
    *,
    schema: type,
    rename: Mapping[str, str] | None = None,
    reject_writer: Writer | None = None,
    name: str = DEFAULT_SILVER_NAME,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Compose the standard silver hop: canonicalise, coerce, quarantine, validate.

    In order: ``rename`` maps the source's own column names onto the schema's
    canonical identifiers (omitted entirely when there is nothing to rename);
    ``SchemaCoercion`` repairs the dtypes a storage round-trip loses;
    ``reject_writer``, when given, partitions value-rule breaches off to
    quarantine so the good rows still land; and ``SchemaValidator`` checks the
    declared schema at the silver boundary. A structural breach still aborts the
    run — quarantine is for row-level value rules, not a missing column.
    """
    p = Pipeline(name, run_log=run_log)
    node = p.read(reader, name="read")
    if rename:
        node = p.transform(Rename(rename), node, name="rename")
    node = p.transform(SchemaCoercion(schema), node, name="coerce")
    if reject_writer is not None:
        node = p.quarantine(
            SchemaValueRulePartitioner(schema),
            reject_writer,
            node,
            name="quarantine",
        )
    node = p.validate(SchemaValidator(schema), node, name="post-validate")
    p.write(writer, node, name="write")
    return p
