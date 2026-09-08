```python
"""One canonical encoding for every deterministic identity in this repository.

A derived id is only as good as the encoding underneath it. Two rules, settled
here once so no caller re-decides them:

*Hash the mapping, not a joined string.* A ``sep.join(values)`` key is
**forgeable** — a value that contains the separator can reproduce a different
row's key string exactly, minting one id for two distinct things
(``{"a": "x|b=y"}`` and ``{"a": "x", "b": "y"}`` collide under ``"|"``). JSON
escapes its own delimiters, so no value can close the field it sits inside.

*Hash with ``sha256``, never Python's ``hash()``.* The built-in is salted per
process, so the same input identifies differently on every run and every
machine — the exact opposite of what a deterministic key is for.

The encoding is a live on-disk format: an id, once published, was minted by it,
so changing the separators, the key order, the value rendering or the digest
re-keys history.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json

import pandas as pd


def sha256_json(payload: dict[str, object]) -> str:
    """Identify ``payload`` as a stable lowercase ``sha256`` hex digest.

    Keys are sorted (at every level) and the separators are tight, so the digest
    depends on the mapping's *content* and not on the order a caller happened to
    build it in. Values must be JSON-encodable; nest a mapping to group them.
    """
    encoded = json.dumps(
        payload, sort_keys=True, ensure_ascii=True, separators=(",", ":")
    )
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def canonical_text(value: object) -> str | None:
    """One value as the text an identity is built from, or ``None`` if it is null.

    Hashing ``str(value)`` directly is not safe, because the *same* value renders
    differently depending on the dtype of the column it arrived in:

    - A whole number in a column that has gained a null is a ``float64``, so
      ``7`` renders ``"7.0"``. One missing value elsewhere in the column would
      otherwise re-key every other row in it.
    - Every flavour of null renders as a plausible, *different* string --
      ``"None"``, ``"nan"``, ``"<NA>"`` -- so a missing value would mint an
      identity that looks present and is not, chosen by dtype.

    Which means asking pandas rather than type-testing: a nullable ``Int64``
    column yields ``pd.NA`` and a float32 column a non-``float`` NaN, and both
    slip past ``isinstance(value, float)``.

    Returning ``None`` for a null leaves the *policy* to the caller -- a
    deterministic key has no honest way to identify a missing value and should
    refuse; a digest over an item's whole payload can render it blank.
    """
    if value is None:
        return None
    try:
        if bool(pd.isna(value)):
            return None
    except (TypeError, ValueError):
        # A list/array/dict value: not a null, and not something pandas can
        # answer elementwise. Fall through and render it.
        pass
    if isinstance(value, dt.datetime):
        return value.isoformat()
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)

```
