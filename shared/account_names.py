"""The claims/domain login encoding, for consumers that must match two spellings.

Tenant knowledge, so it lives here rather than in ``framework/``. The other half
of this one encoding is ``platform_frontend/src/services/account-name.js``; keep
the two in step.
"""

CLAIMS_PREFIX = "i:0#.w|"

__all__ = ["CLAIMS_PREFIX", "to_bare_account"]


def to_bare_account(value: object) -> str:
    """Return the lowercase bare name after the final backslash.

    Blank, ``None`` and NaN become ``""``. The self-inequality NaN check does
    not support ``pandas.NA``; add an explicit guard if nullable readers reach
    this function.
    """
    if value is None or value != value:
        return ""
    text = str(value).strip()
    if text.startswith(CLAIMS_PREFIX):
        text = text[len(CLAIMS_PREFIX) :]
    return text.rsplit("\\", 1)[-1].strip().lower()
