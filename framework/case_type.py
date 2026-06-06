"""``CaseType`` / ``Variation`` — the declarative domain objects (#11).

A **Case Type** is a first-class classification of Cases that determines its
fields (its :mod:`~framework.schema` dataclass), its Variations, and — over time
— its ingest/selection/processing (CONTEXT.md). It is an **explicit declarative
object imported directly**, not entries in a global CaseType config registry
(ADR-0005; the CasePool-scope resolution in CONTEXT.md). The runner's registry
is separate: it dispatches named domain Pipelines and checks upstream freshness.

A **Variation** is a specialization within a Case Type that inherits its config
and overrides only what differs — most commonly the **Question Bank**
(``question_bank_id``). One Case Type has many Variations (A ~3; B ~100), so they
are data, not code; the rare divergent processing is a later override. Selection
resolves "which Question Bank" for a run via :meth:`CaseType.variation`, then
stamps that id onto the selected Cases (CONTEXT.md).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Variation:
    """A specialization of a Case Type — most often just its Question Bank.

    ``id`` names the Variation within its Case Type; ``question_bank_id`` is the
    reference the framework stamps onto selected Cases so the review platform
    knows which bank to present (the framework stores only the reference, never
    the bank's content — CONTEXT.md). Further overrides (ingest, selection
    criteria, processing) are deferred (ADR-0005).
    """

    id: str
    question_bank_id: str


@dataclass(frozen=True)
class CaseType:
    """A Case Type: its schema bundled with its declarative Variations.

    ``name`` is the subject (the medallion directory / table name); ``schema`` is
    the Case Type dataclass enforced at the silver/gold boundaries; ``variations``
    are its declared Variations. No global CaseType config registry — a CaseType
    is imported and passed directly (ADR-0005).
    """

    name: str
    schema: type
    variations: tuple[Variation, ...] = ()

    def variation(self, variation_id: str) -> Variation:
        """Return the Variation with ``variation_id``; raise if it is unknown.

        An unknown id is a configuration error surfaced here, with a located
        message naming the Case Type and the id, rather than a silent miss
        downstream in Selection.
        """
        for variation in self.variations:
            if variation.id == variation_id:
                return variation
        raise KeyError(
            f"{self.name} Case Type has no Variation {variation_id!r}"
        )
