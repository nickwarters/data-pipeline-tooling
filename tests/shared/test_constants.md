```python
from pathlib import Path

from shared.constants import DEV_ROOT, PROD_ROOT


def test_committed_default_roots_are_paths():
    assert isinstance(DEV_ROOT, Path)
    assert isinstance(PROD_ROOT, Path)
    assert DEV_ROOT == Path("data")
    assert PROD_ROOT == Path.home() / "pipelines_prod"

```
