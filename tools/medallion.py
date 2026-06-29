"""The raw → silver → gold medallion, as an application-level store profile.

The medallion is no longer framework vocabulary (#232): ``framework.io`` stores
an opaque ``namespace`` (a logical database) → file, and this helper layers the
conventional three-layer medallion on top. A subject's three layers are three
namespaces under it — ``<subject>/raw``, ``<subject>/silver``, ``<subject>/gold``
— so the on-disk layout stays ``<root>/<subject>/{raw,silver,gold}.db``, isolated
per subject (ADR-0001).

Usage::

    from framework.io import Refresh
    from tools.store import StoreRegistry
    from tools.medallion import medallion

    med = medallion(StoreRegistry(base_dir), "cases")
    med.raw.writer("cases", Refresh()).write(dataset)
    raw = med.raw.reader("cases").read()
    med.silver.quarantine_writer("cases")

Each of ``med.raw`` / ``med.silver`` / ``med.gold`` is an ordinary
:class:`~tools.store.Store` scoped to that layer's namespace, so the
table-scoped ``writer(table, strategy)`` / ``reader(table)`` surface is the
same one the registry mints.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

from tools.store import Store, StoreRegistry

# The conventional medallion layer names. They are a profile convention here, not
# a framework enum — the framework knows only namespaces (ADR-0001 amendment).
RAW = "raw"
SILVER = "silver"
GOLD = "gold"
LAYERS = (RAW, SILVER, GOLD)


@dataclass(frozen=True)
class Medallion:
    """A subject's three medallion-layer namespace Stores."""

    raw: Store
    silver: Store
    gold: Store


def medallion(registry: StoreRegistry, subject: str | os.PathLike[str]) -> Medallion:
    """Mint a subject's raw/silver/gold namespace Stores from ``registry``.

    Each layer is the namespace ``<subject>/<layer>``, so the registry's backend
    maps it to that subject's own file and the three stay together and isolated.
    """
    subject = str(subject)
    return Medallion(
        raw=registry.store(f"{subject}/{RAW}"),
        silver=registry.store(f"{subject}/{SILVER}"),
        gold=registry.store(f"{subject}/{GOLD}"),
    )
