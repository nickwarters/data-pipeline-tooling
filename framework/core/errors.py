"""The expected-failure vocabulary every pipeline run can raise, and how to show it.

A ``PipelineError`` is a *fail-fast, expected* failure: a feed broke a declared
expectation (a Validator breach), an upstream was stale, a coercion could not be
applied, or a named pipeline was unknown. These are the failures an operator is
meant to read and act on — not bugs in the framework. Grouping them under one
base lets a run boundary catch the whole family with a single ``except`` and
present it cleanly via :func:`format_failure`, while a genuine programming error
(a ``KeyError`` in a transform) keeps its full traceback.

The base lives here in ``core`` — the vocabulary everything builds on — so the
``validate`` / ``transform`` / ``run`` facades can each subclass it without
importing one another. :func:`format_failure` sits beside it: the error family
and the function that presents it are one matched pair, and the formatter touches
only the exception, never any run machinery. Each concrete error keeps its own
message; the base adds no behaviour beyond being the common ancestor.
"""

from __future__ import annotations


class PipelineError(Exception):
    """Base for expected, fail-fast failures raised while running a pipeline."""


def format_failure(error: BaseException) -> str:
    """Return a clean, traceback-free rendering of a failed pipeline run.

    A pipeline run is fail-fast: an error-severity breach aborts and the failing
    :class:`PipelineError` propagates (already recorded to the run log). At a run
    boundary — the operator CLI, a scaffolded ``main()`` — that exception
    otherwise surfaces as a raw traceback that *looks* unhandled even though the
    abort was deliberate. This turns the caught exception into a short, clear
    block for stderr: the failure kind and its message, no stack trace.

    It is a *pure formatter* — it never catches, suppresses, or exits. The caller
    keeps control flow: catch :class:`PipelineError`, print this, return
    non-zero. That keeps the recording/exit decisions where they already live and
    lets a genuine bug (anything that is *not* a ``PipelineError``) keep its
    traceback.

    The output is plain ASCII so it renders identically on Windows consoles and
    macOS terminals (the framework's cross-platform constraint), and it always
    contains the exception's own message verbatim so existing message text
    remains greppable. A multi-line message keeps its line breaks.
    """
    kind = type(error).__name__
    message = str(error) or kind
    body = "\n".join(f"  {line}" for line in message.splitlines() or [""])
    return f"Pipeline run failed [{kind}]\n{body}"
