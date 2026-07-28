"""Migrating the medallion: the ``migrations/`` tree, topology profiles, and the runner.

``tools.schema`` (see ``tools/schema/``) declares what a table's shape *should*
be and reports drift; this package is what actually gets a live database to
that shape. Three pieces:

- :mod:`tools.migrations.scope` / :mod:`tools.migrations.discovery` -- the
  ``migrations/`` tree's own rules: directory path is scope, filename is a
  globally-ordered version + slug, and the whole tree is discoverable with no
  manifest.
- :mod:`tools.migrations.topology` -- **topology profiles**, each a different
  way of bundling those scopes into physical database files
  (``<subject>/<layer>.db`` today; ``warehouse.db``; ``<layer>.db``;
  ``<phase>.db``). An environment names its profile in
  ``tools/environments.py``.
- :mod:`tools.migrations.ledger` / :mod:`tools.migrations.runner` -- the
  per-database ``schema_migrations`` ledger and the transactional apply/plan
  logic (``migrate``'s engine).

:mod:`tools.schema.emit` (a sibling module under ``tools/schema/``, not this
package) turns a declaration's drift into the migration SQL text
``migrations make`` writes to the tree -- authoring stays next to the
declaration it reads, applying stays here.

Application infrastructure in the sibling ``tools`` package, not framework
vocabulary -- see [`docs/migrations.md`](../../docs/migrations.md).
"""

from __future__ import annotations
