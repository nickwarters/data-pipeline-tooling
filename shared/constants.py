"""Shared root declarations used by the application environment mapping.

``DEV_ROOT`` is the implicit development default. ``PROD_ROOT`` is the
production default under the user's home directory; either root can be
overridden by its environment-specific OS variable.
"""

from pathlib import Path

DEV_ROOT = Path("data")
PROD_ROOT = Path.home() / "pipelines_prod"

__all__ = ["DEV_ROOT", "PROD_ROOT"]
