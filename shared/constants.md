```python
"""Shared root declarations used by the application environment mapping.

``DEV_ROOT`` is the implicit development default. ``PROD_ROOT`` is the
production default under the user's home directory; either root can be
overridden by its environment-specific OS variable.

``QUEUE_DIR_NAME`` names the directory the Forwarder takes pending files from,
and ``PROCESSED_DIR_NAME`` the sibling directory a file is moved into once it
has been delivered. They are declared here, rather than in ``forwarder/``,
because they are a layout both projects can read.
"""

from pathlib import Path

DEV_ROOT = Path("data")
PROD_ROOT = Path.home() / "pipelines_prod"

QUEUE_DIR_NAME = "QUEUE"
PROCESSED_DIR_NAME = "PROCESSED"

__all__ = ["DEV_ROOT", "PROCESSED_DIR_NAME", "PROD_ROOT", "QUEUE_DIR_NAME"]

```
