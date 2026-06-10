"""Declarative Variation registry — load Variations from YAML config (#58).

Case Type B has ~100 Variations and Case Type A only ~3; hand-constructing
``Variation`` objects in Python does not scale and contradicts CONTEXT.md's
principle that Variations are *declarative/data-driven*. This module is the
data-driven loader: it reads a YAML file where each Variation is, in the common
case, a one-line ``id: question_bank_id`` entry, and mints the ``Variation``
objects, binding them to their Case Type's code-defined ``schema``.

The Case Type ``schema`` is a Python type and stays in code; only the Variations
— the part that scales out to ~100 — are declared in config. A Variation thus
*inherits* its Case Type (its schema and the rest of its config) by being bound
into the one ``CaseType`` object, and *overrides* only its ``question_bank_id``.
"""

from __future__ import annotations

from pathlib import Path

import yaml

from case_review.case_type import CaseType, Variation


def load_variations(config_path: Path) -> tuple[Variation, ...]:
    """Load the Variations declared in the YAML file at ``config_path``."""
    document = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    mapping = document.get("variations") or {}
    if not isinstance(mapping, dict):
        raise ValueError(
            f"{config_path}: `variations` must be an id -> question_bank_id "
            f"mapping, got {type(mapping).__name__}"
        )
    return tuple(
        Variation(id=variation_id, question_bank_id=question_bank_id)
        for variation_id, question_bank_id in mapping.items()
    )


def case_type_from_config(
    name: str, schema: type, config_path: Path
) -> CaseType:
    """Build a ``CaseType`` binding ``schema`` to its config-declared Variations.

    The ``schema`` is a Python type and stays in code; the Variations — the part
    that scales to ~100 — are loaded from ``config_path``. Binding both into the
    one ``CaseType`` is how a Variation *inherits* its Case Type.
    """
    return CaseType(
        name=name,
        schema=schema,
        variations=load_variations(config_path),
    )
