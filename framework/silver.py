"""The raw->silver builder — enforce a Case Type's schema at the silver boundary.

This factory encodes the ADR-0008 convention in one place: **raw** is landed
schema-light, then **silver** is where the declared :mod:`~framework.schema`
contract is enforced. It wires the subject's raw Reader and silver Writer into a
deferred :class:`~framework.builder.Pipeline` with the ``SchemaValidator``
attached as a **post**-validator, so the schema is checked on the output that is
about to be written. Nothing runs until ``.run()`` — and a breach aborts the run
atomically *before* silver is written (fail-fast, ADR-0007).

It makes no write or load decisions of its own (ADR-0003): the Store mints the
layer-appropriate Writer/Reader, the Writer owns its location and load strategy.
A coercion processor (parsing dates, casting booleans) belongs between raw and
this validator in a later slice; today the builder validates the raw shape as
it lands in silver.
"""

from __future__ import annotations

from framework.builder import Pipeline
from framework.run_log import RunLog
from framework.schema import SchemaValidator
from framework.store import Store


def raw_to_silver(
    store: Store,
    table: str,
    schema: type,
    *,
    name: str | None = None,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Compose the deferred raw->silver pipeline for one subject's ``table``.

    Reads ``store``'s raw ``table``, enforces ``schema`` as a post-validator,
    and writes the silver ``table``. ``name`` labels the run for observability
    (defaults to ``table``); ``run_log`` is the optional run-log sink. Returns
    the composed :class:`~framework.builder.Pipeline`; call ``.run()`` to execute.
    """
    return (
        Pipeline(name or table, store.reader("raw", table), run_log)
        .with_post_validator(SchemaValidator(schema))
        .write_to(store.writer("silver", table))
    )
