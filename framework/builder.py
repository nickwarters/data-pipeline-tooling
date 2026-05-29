"""The deferred fluent builder — describes a pipeline; executes on ``.run()``.

A ``Pipeline`` composes a feed's reader and its destination Writer (and, in
later slices, processors and validators) without running anything. Execution
happens only at the ``.run()`` terminus, which owns the cross-cutting concerns
— timing, logging, lineage, error handling — for every stage. The builder makes
**no** write decisions: it hands the read ``DataHandle`` to the composed Writer,
which owns its own location and load strategy (ADR-0003, ADR-0006).
"""

from __future__ import annotations

import logging

from framework.data_handle import DataHandle
from framework.readers import Reader
from framework.validators import Severity, ValidationError, Validator
from framework.writers import Writer

log = logging.getLogger(__name__)


class Pipeline:
    """A deferred pipeline for one feed: read, then hand off to a Writer."""

    def __init__(self, name: str, reader: Reader) -> None:
        # `name` labels the feed/pipeline (for lineage in later slices); it is
        # not a write decision — the Writer owns the target table. Nothing runs
        # at construction.
        self._name = name
        self._reader = reader
        self._writer: Writer | None = None
        # Validators are attached with their severity and run in attach order:
        # pre-validators gate the input, post-validators gate the output that is
        # about to be written.
        self._pre_validators: list[tuple[Validator, Severity]] = []
        self._post_validators: list[tuple[Validator, Severity]] = []

    def with_validator(
        self, validator: Validator, severity: Severity = "error"
    ) -> "Pipeline":
        """Attach a pre-validator (checks the input). Deferred — nothing runs."""
        self._pre_validators.append((validator, severity))
        return self

    def with_post_validator(
        self, validator: Validator, severity: Severity = "error"
    ) -> "Pipeline":
        """Attach a post-validator (checks the output). Deferred."""
        self._post_validators.append((validator, severity))
        return self

    def write_to(self, writer: Writer) -> "Pipeline":
        """Compose in the destination Writer. Deferred — nothing runs yet."""
        self._writer = writer
        return self

    def run(self) -> DataHandle:
        """Execute: read, validate, hand the handle to the Writer, return it.

        Fail-fast and atomic (ADR-0007): an error-severity validator aborts the
        run *before* the Writer is called, so nothing partial lands; a
        warn-severity failure logs and continues. The write itself is a single
        SQLite transaction owned by the Writer. Returns the bulk-tier
        ``DataHandle`` (ADR-0003).
        """
        handle = self._reader.read()
        self._validate(self._pre_validators, handle, "pre-validate")
        # Processors transform the handle here in a later slice; post-validators
        # then gate that output. Today the output is the read handle unchanged.
        self._validate(self._post_validators, handle, "post-validate")
        if self._writer is not None:
            self._writer.write(handle)
        return handle

    def _validate(
        self,
        validators: list[tuple[Validator, Severity]],
        handle: DataHandle,
        phase: str,
    ) -> None:
        for validator, severity in validators:
            try:
                validator.validate(handle)
            except ValidationError as exc:
                if severity == "error":
                    raise ValidationError(
                        f"{self._name} {phase} failed: {exc}"
                    ) from exc
                log.warning("%s %s warn: %s", self._name, phase, exc)
