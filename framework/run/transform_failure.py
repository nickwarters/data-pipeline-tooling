"""Turn a transformer's crash into a readable, located ``TransformError``.

A transformer is the author's own code -- a class, a function, often a lambda
written inline -- and when it breaks the raw exception names neither the step it
broke in nor, for a lambda, anything at all: ``KeyError: 'amount'`` from
``<lambda>``, thirty frames under pandas. Both transform steps -- the eager
:func:`~framework.run.steps.transform` and the builder's ``TransformNode`` --
run the transformer inside :func:`transform_failure`, so the same crash
arrives as a :class:`TransformError` that says which step, which transformer
(a lambda by the file, line and source it was written on), what was raised, and
the line of the author's code it was raised from.

Being a :class:`~framework.core.errors.PipelineError`, it is presented through
:func:`~framework.core.errors.format_failure` at a run boundary like every other
failure, instead of as a bare traceback. The original exception is chained as
``__cause__`` (and kept as ``original``), so a debugger, a test, or anyone
calling ``traceback.print_exception`` still has the full stack.

A transformer that raises a ``PipelineError`` of its own -- a
:class:`~framework.transform.processors.CoercionError`, say -- already says
what went wrong in an operator's terms, and passes through untouched.

The wrapping is at the *step*, never inside a transformer, so a transformer
called directly -- in a unit test, or in a scratch file -- raises exactly what
it raised before.
"""

from __future__ import annotations

import functools
import inspect
import types
from contextlib import contextmanager
from typing import Iterator

from framework._internal.describe import component_summary
from framework._internal.source_location import clip, display_path, raised_at
from framework.core.errors import ErrorCategory, PipelineError


class TransformError(PipelineError):
    """A transform step's transformer raised something that is not a ``PipelineError``.

    ``step`` is the step's run-log name, ``transformer`` the description of what
    ran, and ``original`` the exception it raised (also its ``__cause__``).
    """

    category = ErrorCategory.CODE

    def __init__(
        self, message: str, *, step: str, transformer: str, original: BaseException
    ) -> None:
        super().__init__(message)
        self.step = step
        self.transformer = transformer
        self.original = original


@contextmanager
def transform_failure(step: str, transformer: object) -> Iterator[None]:
    """Run a transform step's transformer, re-raising a crash as ``TransformError``."""
    try:
        yield
    except PipelineError:
        raise
    except Exception as exc:
        raise _wrap(step, transformer, exc) from exc


def _wrap(step: str, transformer: object, exc: Exception) -> TransformError:
    described, source = describe_transformer(transformer)
    reason = f"{type(exc).__name__}: {exc}" if str(exc) else type(exc).__name__
    lines = [f"transform step {step!r} failed: {reason}"]
    lines.append(f"transformer: {described}")
    if source:
        lines.append(f"  {source}")
    location = raised_at(exc)
    if location is not None:
        where, code = location
        lines.append(f"raised at {where}")
        if code and code != source:
            lines.append(f"  {code}")
    return TransformError(
        "\n".join(lines), step=step, transformer=described, original=exc
    )


def describe_transformer(transformer: object) -> tuple[str, str | None]:
    """``(description, source line)`` for whatever a transform step was handed.

    A lambda has no name, so it is described by where it was written and the
    source line it was written on; a named function by its qualified name and
    where it lives; a bound method by its owner; a ``partial`` by what it wraps;
    anything else through its own ``describe()``, falling back to its class name.
    Never raises: describing a failure must not become a second one.
    """
    try:
        return _describe(transformer)
    except Exception:  # noqa: BLE001 - a description is best-effort by design
        return type(transformer).__name__, None


def _describe(transformer: object) -> tuple[str, str | None]:
    if isinstance(transformer, functools.partial):
        inner, source = _describe(transformer.func)
        return f"partial({inner})", source
    if isinstance(transformer, types.MethodType):
        owner = transformer.__self__
        owner_name = owner.__name__ if isinstance(owner, type) else type(owner).__name__
        return f"{owner_name}.{transformer.__func__.__name__}", None
    if isinstance(transformer, types.FunctionType):
        code = transformer.__code__
        where = f"{display_path(code.co_filename)}:{code.co_firstlineno}"
        if transformer.__name__ == "<lambda>":
            return f"<lambda> at {where}", _source_line(transformer)
        return f"{transformer.__qualname__} at {where}", None
    if callable(transformer) and not isinstance(transformer, type):
        return component_summary(transformer), None
    return getattr(transformer, "__qualname__", type(transformer).__name__), None


def _source_line(function: types.FunctionType) -> str | None:
    """The stripped source a lambda was written on, or ``None`` if unavailable.

    A lambda written at a REPL or built by ``eval`` has no source file; that is
    not worth failing over, the file and line already say where it came from.
    """
    try:
        lines, _ = inspect.getsourcelines(function)
    except (OSError, TypeError):
        return None
    text = " ".join(line.strip() for line in lines if line.strip())
    return clip(text) if text else None
