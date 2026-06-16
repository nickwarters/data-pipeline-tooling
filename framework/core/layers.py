"""Generic medallion layer names."""

from __future__ import annotations

from enum import StrEnum


class Layer(StrEnum):
    """The framework's conventional medallion layers."""

    RAW = "raw"
    SILVER = "silver"
    GOLD = "gold"


RAW = Layer.RAW
SILVER = Layer.SILVER
GOLD = Layer.GOLD
LAYERS = tuple(layer.value for layer in Layer)


def layer_name(layer: Layer | str) -> str:
    """Return a validated layer name."""
    try:
        return Layer(layer).value
    except ValueError as exc:
        raise ValueError(f"unknown layer {layer!r}; expected one of {LAYERS}") from exc
