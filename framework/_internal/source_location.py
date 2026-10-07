"""Point at the line of the author's code an exception came from.

A crash in pipeline code -- a transformer, or a pipeline module that fails while
it is imported -- surfaces from somewhere deep: thirty frames of pandas, or
Python's import machinery. The traceback's innermost frame says nothing an
author can act on. :func:`raised_at` walks back out to the innermost frame of
*author* code -- anything outside the standard library, installed packages and
the framework itself -- and names its file, line and source text, so an error
message can say where to look without printing the whole traceback.

Private layout: the framework's located errors reach it; pipelines never import
it.
"""

from __future__ import annotations

import functools
import linecache
import os
import sysconfig
import types

# Source shown in a message is capped so one long line cannot swamp it.
MAX_SOURCE_CHARS = 160

# The framework package: its frames are the machinery an author's code runs
# inside, never the line an author should look at.
_FRAMEWORK_ROOT = os.path.normcase(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)


def raised_at(exc: BaseException) -> tuple[str, str | None] | None:
    """Where the author's code raised ``exc``: ``("path:line, in name", code)``.

    The innermost frame outside the standard library, installed packages and the
    framework -- the author's own line, or the helper it called. When every frame
    is library or framework code, the innermost is used rather than nothing.
    ``None`` only for an exception that was never raised.
    """
    frames = []
    tb = exc.__traceback__
    while tb is not None:
        frames.append(tb)
        tb = tb.tb_next
    if not frames:
        return None
    chosen = next((f for f in reversed(frames) if _is_author_code(f)), frames[-1])
    code = chosen.tb_frame.f_code
    return located(code.co_filename, chosen.tb_lineno, code.co_name)


def located(
    filename: str, lineno: int, name: str | None = None
) -> tuple[str, str | None]:
    """``("path:line[, in name]", source line)`` for one place in a file."""
    line = linecache.getline(filename, lineno).strip() or None
    where = f"{display_path(filename)}:{lineno}"
    if name:
        where += f", in {name}"
    return where, clip(line) if line else None


def display_path(filename: str) -> str:
    """``filename`` relative to the working directory when it sits beneath it.

    ``os.path.relpath`` raises on Windows across drives, and a path climbing out
    with ``..`` reads worse than the absolute one, so both keep the original.
    """
    if filename.startswith("<"):
        return filename
    try:
        relative = os.path.relpath(filename)
    except ValueError:
        return filename
    return filename if relative.startswith(os.pardir) else relative


def clip(text: str) -> str:
    """``text`` cut to :data:`MAX_SOURCE_CHARS`, marked when it was cut."""
    if len(text) <= MAX_SOURCE_CHARS:
        return text
    return text[: MAX_SOURCE_CHARS - 3] + "..."


@functools.lru_cache(maxsize=1)
def _library_roots() -> tuple[str, ...]:
    """The standard library and installed-package directories, normalised."""
    paths = sysconfig.get_paths()
    roots = {paths.get(k) for k in ("stdlib", "platstdlib", "purelib", "platlib")}
    return tuple(os.path.normcase(os.path.abspath(r)) for r in roots if r)


def _is_author_code(tb: types.TracebackType) -> bool:
    filename = tb.tb_frame.f_code.co_filename
    # ``<frozen importlib._bootstrap>`` and friends have no file; a compiled
    # extension reports the path of the source it was built from
    # (``pandas/_libs/tslibs/strptime.pyx``), which is not a file here either.
    if filename.startswith("<") or not os.path.isfile(filename):
        return False
    normalised = os.path.normcase(os.path.abspath(filename))
    roots = (_FRAMEWORK_ROOT, *_library_roots())
    return not any(normalised.startswith(root + os.sep) for root in roots)
