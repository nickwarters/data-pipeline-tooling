```python
"""Stable addresses for pipeline and step dependency targets."""

from __future__ import annotations

from framework.core.errors import ErrorCategory, PipelineError


class RunAddressError(PipelineError):
    """Raised when a configured run address cannot be parsed."""

    category = ErrorCategory.CONFIG


class _ClassFactoryInstanceValue:
    def __init__(self, name: str, factory):
        self._storage_name = f"_{name}"
        self._factory = factory

    def __get__(self, instance: object | None, owner: type):
        if instance is None:
            return self._factory.__get__(owner, owner)
        return getattr(instance, self._storage_name)


class RunAddress:
    """A stable label for a whole pipeline or one step within it."""

    __slots__ = ("_pipeline", "_subject", "_step")

    def __init__(
        self, pipeline: str, *, subject: str | None = None, step: str | None = None
    ) -> None:
        _validate_part("pipeline", pipeline)
        if subject is not None:
            _validate_part("subject", subject)
        if step is not None:
            _validate_part("step", step)
        object.__setattr__(self, "_pipeline", pipeline)
        object.__setattr__(self, "_subject", subject)
        object.__setattr__(self, "_step", step)

    def __setattr__(self, name: str, value: object) -> None:
        raise AttributeError("RunAddress is immutable")

    def _pipeline_factory(
        cls, pipeline: str, *, subject: str | None = None
    ) -> "RunAddress":
        """Return an address for a whole Pipeline."""

        return cls(pipeline, subject=subject)

    def _step_factory(
        cls, pipeline: str, step: str, *, subject: str | None = None
    ) -> "RunAddress":
        """Return an address for a named step inside a Pipeline."""

        return cls(pipeline, subject=subject, step=step)

    pipeline = _ClassFactoryInstanceValue("pipeline", _pipeline_factory)
    step = _ClassFactoryInstanceValue("step", _step_factory)

    @classmethod
    def task(
        cls, pipeline: str, task: str, *, subject: str | None = None
    ) -> "RunAddress":
        """Compatibility alias for the current builder's Task vocabulary."""

        return cls.step(pipeline, task, subject=subject)

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

    def __repr__(self) -> str:
        args = [repr(self.pipeline)]
        if self.subject is not None:
            args.append(f"subject={self.subject!r}")
        if self.step is not None:
            args.append(f"step={self.step!r}")
        return f"RunAddress({', '.join(args)})"

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, RunAddress):
            return NotImplemented
        return (
            self.pipeline == other.pipeline
            and self.subject == other.subject
            and self.step == other.step
        )

    def __hash__(self) -> int:
        return hash((self.pipeline, self.subject, self.step))

    @property
    def subject(self) -> str | None:
        return self._subject


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

```
