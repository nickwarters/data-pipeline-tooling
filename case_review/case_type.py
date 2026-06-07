"""``CaseType`` / ``Variation`` — declarative case-review domain objects.

A **Case Type** is a first-class classification of Cases that determines its
fields, its Variations, and, over time, its ingest/selection/processing
configuration. It is an explicit object imported directly by case-review
pipelines, not a framework primitive and not an entry in a global config
registry (ADR-0005).

A **Variation** is a specialization within a Case Type that inherits its config
and overrides only what differs, most commonly the review platform's Question
Bank reference (``question_bank_id``).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Variation:
    """A specialization of a Case Type, most often just its Question Bank."""

    id: str
    question_bank_id: str


@dataclass(frozen=True)
class CaseType:
    """A Case Type: its schema bundled with its declarative Variations."""

    name: str
    schema: type
    variations: tuple[Variation, ...] = ()

    def variation(self, variation_id: str) -> Variation:
        """Return the Variation with ``variation_id``; raise if it is unknown."""
        for variation in self.variations:
            if variation.id == variation_id:
                return variation
        raise KeyError(
            f"{self.name} Case Type has no Variation {variation_id!r}"
        )

