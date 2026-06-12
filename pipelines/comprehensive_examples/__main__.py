"""Module entry point for ``python -m pipelines.comprehensive_examples``."""

from __future__ import annotations

import sys

from .pipeline import main

if __name__ == "__main__":  # pragma: no cover - thin CLI entry
    raise SystemExit(main(sys.argv))
