"""SQL identifier quoting — the single place table/column names are made safe.

SQL **values** are always bound parameters (``?``), but **identifiers** (table
and column names) can never be parameterised, so they must be embedded in the
statement text. This module is the one choke point that turns an identifier into
a safe SQL token: it double-quotes the name (so spaces, hyphens, and reserved
words are legal) and doubles any embedded quote (so a name can neither break out
of the quoting nor inject SQL). Every f-string interpolation of a table or column
name across the SQLite seam goes through :func:`quote_identifier` (issue #138).
"""

from __future__ import annotations


def quote_identifier(name: str) -> str:
    """Return ``name`` as a safely-quoted SQL identifier.

    Wraps the name in double quotes and escapes any embedded double quote by
    doubling it, the SQL-standard quoting SQLite honours. This both makes
    otherwise-illegal names (spaces, hyphens, reserved words) usable and
    neutralises injection, since a value can never escape the quoting.
    """
    return '"' + name.replace('"', '""') + '"'
