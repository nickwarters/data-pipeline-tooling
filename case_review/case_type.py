"""``Variation`` — a declarative case-review domain object — and the retiring
``CaseType`` wrapper.

A **Variation** is a specialization within a Case Type that inherits its config
and overrides only what differs, most commonly the review platform's Question
Bank reference (``question_bank_id``). It is an explicit object imported
directly by case-review pipelines, not a framework primitive and not an entry in
a global registry.

A Case Type's **identity contract** is no longer held here. A feed declares it
explicitly beside its row schema, as a ``NAMESPACE`` string and a
``NATURAL_KEY`` tuple; gold builders take those values as arguments. Callers
source the namespace and natural key for the Case builder and every Detail-Table
builder from that one declaration, so a Case and its Detail rows derive the same
``case_id`` independently with no cross-pipeline join. Changing either value
re-keys history. See
[ADR-0009](../docs/adr/0009-case-identity-and-gold-grain.md).

``CaseType`` below is the retiring wrapper over that contract. The demo feeds no
longer use it — ``tests/integration/test_public_api.py`` holds the migrated
surfaces to that — and the ``--case-type`` scaffold template is the one
remaining caller, migrated in a later slice of the retirement.
"""

from __future__ import annotations

from dataclasses import dataclass

from case_review.variation import Variation


@dataclass(frozen=True)
class CaseType:
    """A Case Type: its schema and identity contract, with its Variations.

    **Retiring.** New feeds declare ``NAMESPACE`` / ``NATURAL_KEY`` beside their
    row schema instead; see the module docstring.

    ``natural_key`` is the feed's stable identifying column(s), and ``name`` is
    the namespace they are keyed in, so the same natural key identifies a
    different Case under each Case Type. Because the namespace *is* the name,
    renaming a Case Type re-keys its history.
    """

    name: str
    schema: type
    natural_key: tuple[str, ...]
    variations: tuple[Variation, ...] = ()

    def variation(self, variation_id: str) -> Variation:
        """Return the Variation with ``variation_id``; raise if it is unknown."""
        for variation in self.variations:
            if variation.id == variation_id:
                return variation
        raise KeyError(f"{self.name} Case Type has no Variation {variation_id!r}")
