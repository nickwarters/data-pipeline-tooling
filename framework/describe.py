"""Helpers for the opt-in ``describe()`` protocol (issue #145).

A component renders its own safe summary for ``Pipeline.describe()`` by
implementing ``describe() -> str``. The builder no longer reflects over a
component's ``__dict__`` to guess what to show or which attribute names look
sensitive; each component decides explicitly what is safe to surface and is
responsible for redacting its own secrets. These helpers exist only to keep
that rendering uniform and one obvious redaction (credentials embedded in a
connection URL) in one place — they introspect nothing.
"""

from __future__ import annotations

import re

# user:pass@ embedded in a connection URL — the one redaction that is a property
# of the *value* (a URL), not of an attribute name, so it lives here rather than
# in name-based guessing.
_URL_CREDENTIALS = re.compile(r"(://)[^/@:\s]+:[^/@\s]+@")


def component_summary(component: object) -> str:
    """Render a component for the plan via its opt-in ``describe()`` protocol.

    Returns the component's own ``describe()`` string when available, its bare
    class name when not, or ``"none"`` for ``None``. The plan never introspects
    attributes, so no value can leak into the summary unexpectedly.
    """
    if component is None:
        return "none"
    describer = getattr(component, "describe", None)
    if callable(describer):
        return str(describer())
    return type(component).__name__


def render(component: object, **fields: object) -> str:
    """Render ``ClassName(key=repr, ...)`` from explicitly chosen fields.

    With no fields the bare class name is returned. Fields whose value is
    ``None`` are omitted so optional config does not clutter the plan; pass a
    pre-formatted string if a literal ``None`` is meaningful.
    """
    shown = {key: value for key, value in fields.items() if value is not None}
    if not shown:
        return type(component).__name__
    rendered = ", ".join(f"{key}={value!r}" for key, value in shown.items())
    return f"{type(component).__name__}({rendered})"


def redact_url(url: str) -> str:
    """Strip any ``user:pass@`` credentials embedded in a connection URL."""
    return _URL_CREDENTIALS.sub(r"\1<redacted>@", url)
