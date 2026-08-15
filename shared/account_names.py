"""The claims/domain login encoding, for consumers that must match two spellings.

Tenant knowledge, so it lives here rather than in ``framework/``. The other half
of this one encoding is ``platform_frontend/src/services/account-name.js``; keep
the two in step.
"""

import pandas as pd

CLAIMS_PREFIX = "i:0#.w|"
AD_DOMAIN = "CONTOSO"

__all__ = ["CLAIMS_PREFIX", "AD_DOMAIN", "to_bare_account"]


def to_bare_account(value: object) -> str:
    """Reduce a login to its bare account name, lower-cased.

    Blank, ``None`` and NaN all reduce to ``""`` — never a match, because two
    people with no login are not the same person.
    """
    if value is None or (not isinstance(value, str) and pd.isna(value)):
        return ""
    text = str(value).strip()
    if text.startswith(CLAIMS_PREFIX):
        text = text[len(CLAIMS_PREFIX) :]
    return text.rsplit("\\", 1)[-1].strip().lower()
