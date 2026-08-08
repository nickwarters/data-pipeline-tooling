"""Declarative Variations within a Case Type."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Variation:
    """A specialization of a Case Type, most often just its Question Bank."""

    id: str
    question_bank_id: str


def variation_by_id(variations: tuple[Variation, ...], variation_id: str) -> Variation:
    """Return the declared Variation with ``variation_id``."""
    try:
        return next(
            variation for variation in variations if variation.id == variation_id
        )
    except StopIteration:
        raise KeyError(f"No Variation with id {variation_id!r}") from None
