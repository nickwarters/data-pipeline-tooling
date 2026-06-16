"""Compatibility imports for medallion recipes.

The implementation lives in :mod:`framework.recipes.medallion`; this module
keeps the original import path stable while recipes move out of the run engine.
"""

from framework.recipes.medallion import raw_to_silver

__all__ = ["raw_to_silver"]
