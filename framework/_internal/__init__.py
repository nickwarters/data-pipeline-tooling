"""Private, cross-cutting framework internals — **not** a public facade.

Helpers used by more than one facade that carry no public name of their own:
``connection`` (the ``connect`` factory seam, ADR-0001) and ``describe`` (the
``render`` / ``redact_url`` helpers behind the opt-in ``describe()`` protocol).
The leading underscore marks the whole package as internal layout: pipelines and
the case-review layer never import from here. See ``docs/public-api.md``.
"""
