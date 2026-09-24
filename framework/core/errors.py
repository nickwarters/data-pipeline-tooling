"""The expected-failure vocabulary every pipeline run can raise, and how to show it.

A ``PipelineError`` is a *fail-fast, expected* failure: a feed broke a declared
expectation (a Validator breach), an upstream was stale, a coercion could not be
applied, or a named pipeline was unknown. These are the failures an operator is
meant to read and act on — not bugs in the framework. Grouping them under one
base lets a run boundary catch the whole family with a single ``except`` and
present it cleanly via :func:`format_failure`, while a genuine programming error
(a ``KeyError`` in a transform) keeps its full traceback.

The base lives here in ``core`` so validators and the ``transform`` / ``run``
facades can share it without importing one another. :func:`format_failure` sits
beside it: the error family and the function that presents it are one matched
pair, and the formatter touches only the exception, never any run machinery.
Each concrete error keeps its own message; the base adds no behaviour beyond
being the common ancestor.
"""

from __future__ import annotations


class ErrorCategory:
    """How an expected failure should be triaged — recorded on the run log.

    A ``PipelineError`` already names *what* broke (its class); the category names
    *whose problem it is*, so an operator scanning a run log can route a failure
    without reading every message:

    - ``DATA`` — the feed broke a declared data expectation (a schema/value-rule
      breach, an uncastable value). The fix is in the **data**.
    - ``OPERATIONAL`` — the data and the code are fine but the run conditions are
      not (a stale upstream, a per-item failure in a batch, a locked database, a
      CSV source file that has not landed). The fix is in the
      **run/environment**.
    - ``CONFIG`` — the pipeline is mis-addressed or mis-wired (an unknown
      pipeline, a table or column no migration declares). The fix is in the
      **wiring**.
    - ``CODE`` — a transform step's transformer crashed (a ``KeyError`` in a
      lambda, a pandas error in a helper). The fix is in the **transform code**,
      or in data it did not anticipate. Raised as
      :class:`~framework.run.transform_failure.TransformError`, which names the
      step, the transformer and the author's line that raised, and chains the
      original exception so its traceback is still there for a debugger. A
      pipeline module that raises while being imported by path is the same
      kind of fault, raised as
      :class:`~framework.run.runner.PipelineLoadError`.

    Note the deliberate gap: a source that won't open (other than a missing CSV
    file, below) is **not** categorised here — it stays a raw exception with a
    full traceback (the "expected failure vs. genuine bug" line), and so does a
    bug anywhere *outside* a transform step's transformer — a reader, a writer, a
    validator, the framework itself. A crash inside a transformer used to sit in
    that gap too; it left because a transformer is the author's own code, often
    an unnamed lambda, and its raw traceback named neither the step nor the
    lambda. A failed *write* used to sit in that gap and
    no longer does: SQLite's own complaint names neither the table nor the
    database, and pandas re-raises it with the message flattened to ``Execution
    failed``, so a Writer translates it into ``MissingColumnError`` (config) or
    ``SqliteWriteError`` (operational) rather than leaving an operator to read a
    traceback for it. A CSV reader's *missing source file* has left it too: it
    is the commonest way a feed fails — the export has not landed — so the CSV
    readers raise ``MissingSourceFileError`` (operational) for it.
    """

    DATA = "data"
    OPERATIONAL = "operational"
    CONFIG = "config"
    CODE = "code"


class PipelineError(Exception):
    """Base for expected, fail-fast failures raised while running a pipeline.

    ``category`` (one of :class:`ErrorCategory`) classifies the failure for the
    run log; subclasses override it. The base defaults to ``OPERATIONAL`` — a
    generic expected abort — so any future subclass is categorised even before it
    chooses a more specific bucket.
    """

    category: str = ErrorCategory.OPERATIONAL


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
    category = getattr(error, "category", None)
    label = f"{kind}, {category}" if category else kind
    message = str(error) or kind
    body = "\n".join(f"  {line}" for line in message.splitlines() or [""])
    return f"Pipeline run failed [{label}]\n{body}"
