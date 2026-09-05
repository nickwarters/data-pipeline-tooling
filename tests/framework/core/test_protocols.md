```python
"""The shared protocol module's declared constants.

The protocols themselves are exercised through the components that implement
them; what needs pinning here is the vocabulary declared *beside* them, because
a constant is only a contract if there is exactly one of it and everything
names that one.
"""

import framework.core as core
import framework.io as io
from framework.core.protocols import RUN_PROVENANCE_COLUMN


def test_the_run_provenance_column_is_declared_once_and_reachable_from_both_facades():
    # Stamping the column is a *Writer's* rule, so the name is declared beside
    # the Writer protocol — not in an application package, and not once per
    # Writer. Both facades re-export the same object rather than a copy of the
    # string, so there is nothing to drift.
    assert RUN_PROVENANCE_COLUMN == "pipeline_run_id"
    assert core.RUN_PROVENANCE_COLUMN is RUN_PROVENANCE_COLUMN
    assert io.RUN_PROVENANCE_COLUMN is RUN_PROVENANCE_COLUMN
    assert "RUN_PROVENANCE_COLUMN" in core.__all__
    assert "RUN_PROVENANCE_COLUMN" in io.__all__

```
