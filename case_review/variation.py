"""Declarative Variations within a Case Type."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Variation:
    """A specialization of a Case Type, most often just its Question Bank."""

    id: str
    question_bank_id: str
