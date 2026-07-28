"""Stable addresses for pipeline and step dependency targets."""

from __future__ import annotations

from dataclasses import dataclass, field

from framework.core.errors import ErrorCategory, PipelineError


class RunAddressError(PipelineError):
    """Raised when a configured run address cannot be parsed."""

    category = ErrorCategory.CONFIG


@dataclass(frozen=True, slots=True)
class RunAddress:
    """A stable label for a whole pipeline or one step within it.

    The three parts are the address: the pipeline, an optional subject that
    qualifies it, and an optional step inside it. Frozen because an address is
    a value — two addresses with the same parts are the same address, and are
    interchangeable as dict keys and set members.
    """

    pipeline: str
    subject: str | None = field(default=None, kw_only=True)
    step: str | None = field(default=None, kw_only=True)

    def __post_init__(self) -> None:
        _validate_part("pipeline", self.pipeline)
        if self.subject is not None:
            _validate_part("subject", self.subject)
        if self.step is not None:
            _validate_part("step", self.step)

    @classmethod
    def for_pipeline(cls, pipeline: str, *, subject: str | None = None) -> "RunAddress":
        """Return an address for a whole Pipeline."""

        return cls(pipeline, subject=subject)

    @classmethod
    def for_step(
        cls, pipeline: str, step: str, *, subject: str | None = None
    ) -> "RunAddress":
        """Return an address for a named step inside a Pipeline."""

        return cls(pipeline, subject=subject, step=step)

    @classmethod
    def task(
        cls, pipeline: str, task: str, *, subject: str | None = None
    ) -> "RunAddress":
        """Compatibility alias for the current builder's Task vocabulary."""

        return cls.for_step(pipeline, task, subject=subject)

    @classmethod
    def parse(cls, label: str) -> "RunAddress":
        """Parse a stable run-address label.

        Accepted labels are ``pipeline``, ``subject/pipeline``,
        ``pipeline.step``, and ``subject/pipeline.step``.
        """

        if not isinstance(label, str) or not label:
            raise RunAddressError(
                "Invalid run address: label must be a non-empty string"
            )

        try:
            subject, target = _split_subject(label)
            pipeline, step = _split_step(target)
            return cls(pipeline, subject=subject, step=step)
        except RunAddressError:
            raise
        except ValueError as exc:
            raise RunAddressError(f"Invalid run address '{label}': {exc}") from exc

    @property
    def label(self) -> str:
        """Return the stable string label used in logs and registry queries."""

        target = self.pipeline if self.step is None else f"{self.pipeline}.{self.step}"
        return target if self.subject is None else f"{self.subject}/{target}"

    def __str__(self) -> str:
        return self.label


def _split_subject(label: str) -> tuple[str | None, str]:
    parts = label.split("/")
    if len(parts) > 2:
        raise ValueError("expected at most one '/' subject separator")
    if len(parts) == 1:
        return None, parts[0]

    subject, target = parts
    if not subject:
        raise ValueError("subject is empty")
    if not target:
        raise ValueError("pipeline is empty")
    return subject, target


def _split_step(target: str) -> tuple[str, str | None]:
    parts = target.split(".")
    if len(parts) > 2:
        raise ValueError("expected at most one '.' step separator")
    if len(parts) == 1:
        pipeline = parts[0]
        if not pipeline:
            raise ValueError("pipeline is empty")
        return pipeline, None

    pipeline, step = parts
    if not pipeline:
        raise ValueError("pipeline is empty")
    if not step:
        raise ValueError("step is empty")
    return pipeline, step


def _validate_part(name: str, value: str) -> None:
    if not isinstance(value, str) or not value:
        raise RunAddressError(f"Invalid run address: {name} must be a non-empty string")
    if "/" in value or "." in value:
        raise RunAddressError(
            f"Invalid run address: {name} must not contain '/' or '.'"
        )
