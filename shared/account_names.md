```python
"""The claims/domain login encoding, for consumers that must match two spellings.

Tenant knowledge, so it lives here rather than in ``framework/``. The other half
of this one encoding is ``platform_frontend/src/services/account-name.js``; keep
the two in step.
"""

CLAIMS_PREFIX = "i:0#.w|"

__all__ = ["CLAIMS_PREFIX", "to_bare_account"]


def to_bare_account(value: object) -> str:
    """Reduce a login to its bare account name, lower-cased.

    Any ``DOMAIN\\`` segment is stripped, not just this farm's: the segment
    after the last backslash is the account name whatever precedes it.

    Blank, ``None`` and NaN all reduce to ``""`` — never a match, because two
    people with no login are not the same person. ``value != value`` is the
    NaN test, so nothing here reaches behind the ``Dataset`` seam for one. That
    test is ambiguous for pandas' own ``NA``, which no caller can produce today
    because every reader upstream is numpy-backed; moving one to a nullable
    dtype would need a widened guard here.
    """
    if value is None or value != value:
        return ""
    text = str(value).strip()
    if text.startswith(CLAIMS_PREFIX):
        text = text[len(CLAIMS_PREFIX) :]
    return text.rsplit("\\", 1)[-1].strip().lower()

```
