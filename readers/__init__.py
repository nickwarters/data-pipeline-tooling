"""Shared Readers — a cross-subject read declared once, instantiated per pipeline.

    Owned by the pipeline -> the medallion store.
    Not owned by the pipeline -> a Shared Reader.

A **Shared Reader** is a ``Reader`` over a named business dataset that crosses a
subject boundary. Its location and identity are declared **once**, here, in a
module named for the subject that owns the data. A consumer instantiates it with
a ``base_dir`` and nothing else::

    from readers.sharepoint_cases import CurrentCasesReader

    CurrentCasesReader(base_dir=context.base_dir)

The import names the subject. The constructor supplies the root. Everything past
that -- layer, table, file, database, whether there is a database at all -- is
the reader's, so a consumer that names no table and no layer is not asserting
the producer's storage shape. The decision and its reasoning are
``docs/adr/0026-shared-readers-declare-cross-subject-reads.md``.

Nothing here is exported from this package root: a consumer imports the module
named for the subject, because that import is half of what it is meant to say.

Admission rules
---------------

**G1 -- Read-only.** This package mints Readers, never Writers. It is what stops
``readers/`` becoming a second store facade beside ``tools.store``; every feed
still writes through its own medallion.

**G2 -- Admission.** A dataset earns an entry when it is read by a pipeline that
does not produce it, or is a feed's published contract. One consumer inside its
own subject stays local. Removal is a rule too: if an entry drops back to a
single in-subject consumer, it goes back.

**G3 -- One declaration of location.** Once a dataset is here, a consumer may
not rebuild the path to it. No ``medallion(...)`` in a consumer for data it does
not own.

**G4 -- The port is the contract.** ``read() -> Dataset``, ``describe()``,
``data_locations``. Parametrisation happens at construction, never through a
query method.

**G5 -- Read what was written.** A Shared Reader over a stored table is a
pass-through: no projection, no coercion, no re-shaping, no joins, no
aggregation, no as-of filtering. The one carve-out is a reader that *already*
normalises an untrustworthy source, which moves across as it stands; it is not a
licence to add shaping to a new entry.

The ADR carries two more: the module declares its own ``FreshnessRequirement``
(G6), and column guarantees stay with the consumer that needs them, never
growing here into the union of everyone's (G7).

Writing a module
----------------

One module per **subject**, named for the subject that owns the data. One class
per business dataset, named ``<BusinessDataset>Reader`` for the question it
answers and never for the table it sits on -- ``CurrentCasesReader`` has to
survive ``case_current`` being renamed, re-grained or split.

A class rather than a factory: it is a nameable type in signatures and tests, it
carries its own docstring as its contract, and its internals can change without
the call site changing shape. Composition rather than subclassing: ``Reader`` is
a structural Protocol, so an entry wraps the Reader the medallion mints and
delegates ``read`` / ``describe`` / ``data_locations``.

Every constructor takes ``base_dir`` and nothing else -- including a reader that
does not need it yet. A consumer handed a *path* has been told the source is a
file, which is the same class of leak as a table name and the one that breaks
first.
"""
