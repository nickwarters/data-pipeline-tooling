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
the producer's storage shape.

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
query method. A **store** (``QuestionBankStore``) satisfies this rather than
bending it: the store is the factory, so the Reader it mints is already fully
parametrised and still answers ``read()`` and nothing else. What no entry may
grow is ``reader.for_version(...)``.

**G5 -- Read what was written.** A Shared Reader over a stored table is a
pass-through: no projection, no coercion, no re-shaping, no joins, no
aggregation, no as-of filtering. The one carve-out is a reader that *already*
normalises an untrustworthy source, which moves across as it stands; it is not a
licence to add shaping to a new entry.

**G6 -- Column guarantees stay consumer-side.** A reader declares no column
contract. The consumer that needs specific columns keeps its own validator, so
nothing here grows into the union of everyone's needs.

**Not a rule here: how fresh the data has to be.** Two pipelines can read the
same dataset and legitimately want different tolerances, so each consuming
pipeline declares its own ``UPSTREAMS`` and a reader carries no
``FreshnessRequirement``.

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

**A store instead, when the dataset is a family rather than a name.** A Question
Bank is not one dataset: it is two-dimensional in Case Type and version, and
neither dimension is enumerable from here, so a class per dataset would be a
class per Case Type per publication. ``QuestionBankStore(base_dir)`` mints the
Reader instead, the same shape ``tools.store``'s ``Store.reader(table)`` has and
for the same reason::

    store.qb_reader()                         # every current bank's questions
    store.qb_reader(case_type)                # that bank's head
    store.qb_reader(case_type, v, current=False)   # one published snapshot
    store.qb_versions_reader()                # every published snapshot
    store.outcomes_reader(...)                # the same four, at the other grain
    store.outcomes_versions_reader()

The prefix is the *grain* and the arguments are the *scope*; naming no Case Type
is what asks for all of them. ``current`` and ``version`` are two ways of saying
which **kind** of artifact -- the mutable head or an immutable snapshot -- so
each is refused without the other, and ``current`` is keyword-only. That refusal
is not pedantry: ``questionBankVersion`` is absent on an in-progress Case and
present on a completed one, so a consumer passing it straight through would
otherwise read a different kind of file depending on the row, silently.

This is the exception, not a second default: reach for it only when naming every
member is impossible rather than merely tedious, because the store's argument
list is the one thing a consumer *does* have to know.

Two things a store makes it easy to get wrong, both visible above. **A second
grain earns a second Reader, not a wider one** -- an artifact declaring ~50
questions and the ~4 outcomes they map onto is two datasets, and denormalising
them would make anyone counting the small one de-duplicate the large one first.
And **"all of them" is its own question** -- an argument-less ``qb_reader()``
stacks the same rows and reconciles nothing, so it stays a read rather than
becoming an aggregate the consumer cannot see (G5). Finding
none is refused rather than read as an empty dataset: a report of nothing,
published, looks exactly like a report of nothing that is true.

The sweeps are also where a store can quietly *double count*, which is a third
thing to get right. ``qb_versions_reader()`` reads the immutable
``{slug}.{version}.txt`` snapshots and never the mutable ``{slug}.txt`` heads,
because a head declares the version it was last published as -- so the same bank
sits under two names, and reading both lands every question twice, each row
individually correct. Splitting the sweeps along the line the artifacts already
draw costs nothing; de-duplicating afterwards would be shaping, and would hide
the two diverging.

Every constructor takes ``base_dir`` and nothing else -- including a reader that
does not need it yet. A consumer handed a *path* has been told the source is a
file, which is the same class of leak as a table name and the one that breaks
first.
"""
