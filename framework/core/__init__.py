"""Public facade: the foundational data vocabulary.

The two nouns every pipeline names regardless of task — ``Dataset`` (the opaque
tabular carrier that flows through every Reader, Processor, Validator, and
Writer) and the medallion ``Layer`` constants ``RAW`` / ``SILVER`` / ``GOLD``
(where data lands). They sit *below* the task facades: ``io`` / ``transform`` /
``validate`` / ``run`` all build on them, so they have their own base facade
rather than belonging to any one of them.

Import from here rather than the underlying modules::

    from framework.core import Dataset, RAW, SILVER, GOLD

The modules behind this facade (``framework.core.dataset``,
``framework.core.layers``) are internal layout: re-exports here are the public
contract, the submodule paths are not. See ``docs/public-api.md``.
"""

from framework.core.protocols import Processor, Reader, Severity, Validator, Writer
from framework.core.dataset import Dataset
from framework.core.layers import GOLD, RAW, SILVER, Layer

__all__ = [
    "Dataset",
    "Layer",
    "RAW",
    "SILVER",
    "GOLD",
    "Reader",
    "Writer",
    "Processor",
    "Validator",
    "Severity",
]
