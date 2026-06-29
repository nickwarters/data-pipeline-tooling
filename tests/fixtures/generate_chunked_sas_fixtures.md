```python
"""One-off generator for the SAS-format streaming fixtures.

The :class:`~framework.io.readers.SasFileReader` tests stream *real*
SAS-format files. Those binaries are checked in (read back with pandas' built-in
SAS reader — no test-time dependency), and this script is how they were minted.
It is **not** run by the test suite or CI (pytest ignores it: no ``test_`` name,
and pyreadstat is imported only under ``__main__``); run it by hand when a
fixture needs regenerating::

    pip install pyreadstat
    python tests/fixtures/generate_chunked_sas_fixtures.py

pyreadstat cannot write ``sas7bdat`` (only ``read`` it), so the streamed
fixtures are XPORT v5 — the on-disk grammar pandas parses identically to
sas7bdat through the same chunked code path. The ``.gz`` variant exercises the
gzip-on-the-fly path that the real ``extract.sas7bdat.gz`` feed relies on.
"""

from __future__ import annotations

import gzip
import shutil
from pathlib import Path


def main() -> None:
    import pandas as pd
    import pyreadstat

    here = Path(__file__).parent
    frame = pd.DataFrame(
        {
            "id": [1, 2, 3, 4, 5],
            "val": [10, 20, 30, 40, 50],
            "name": ["a", "b", "c", "d", "e"],
        }
    )
    sample = here / "chunked_sample.xpt"
    pyreadstat.write_xport(frame, str(sample), table_name="DATA", file_format_version=5)

    with open(sample, "rb") as src, gzip.open(f"{sample}.gz", "wb") as dst:
        shutil.copyfileobj(src, dst)

    empty = frame.iloc[0:0]
    pyreadstat.write_xport(
        empty, str(here / "chunked_empty.xpt"), table_name="DATA", file_format_version=5
    )


if __name__ == "__main__":
    main()

```
