"""``CaseType`` / ``Variation`` — declarative case-review domain objects.

A **Case Type** is a first-class classification of Cases that determines its
fields, its Variations, and, over time, its ingest/selection/processing
configuration. It is an explicit object imported directly by case-review
pipelines, not a framework primitive and not an entry in a global config
registry (ADR-0005).

A **Variation** is a specialization within a Case Type that inherits its config
and overrides only what differs, most commonly the review platform's Question
Bank reference (``question_bank_id``).

A Case Type also owns its **identity contract** (ADR-0009): the ``natural_key``
columns that identify a Case, and the ``namespace`` those are hashed under to
mint the deterministic ``case_id = uuid5(namespace, natural_key)``. Both the
Case builder and each Detail-Table builder read this one contract off the Case
Type, so a Case and its Detail rows derive the *same* ``case_id`` independently
with no cross-pipeline join — the link is structural, not a convention to keep
in step by hand.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass


@dataclass(frozen=True)
class Variation:
    """A specialization of a Case Type, most often just its Question Bank."""

    id: str
    question_bank_id: str


@dataclass(frozen=True)
class CaseType:
    """A Case Type: its schema and identity contract, with its Variations.

    ``natural_key`` is the feed's stable identifying column(s) (ADR-0009: every
    feed declares its natural key). ``namespace`` is *derived* from ``name`` —
    each Case Type gets its own UUID space — so it is a property, not stored
    config. The derivation is a stable contract: because the namespace seeds from
    the name, renaming a Case Type re-keys all its history (a documented, rare
    trade-off — see ADR-0009).
    """

    name: str
    schema: type
    natural_key: tuple[str, ...]
    variations: tuple[Variation, ...] = ()

    @property
    def namespace(self) -> uuid.UUID:
        """The per-Case-Type UUID space for ``case_id`` derivation (ADR-0009)."""
        return uuid.uuid5(uuid.NAMESPACE_DNS, self.name)

    def variation(self, variation_id: str) -> Variation:
        """Return the Variation with ``variation_id``; raise if it is unknown."""
        for variation in self.variations:
            if variation.id == variation_id:
                return variation
        raise KeyError(
            f"{self.name} Case Type has no Variation {variation_id!r}"
        )

