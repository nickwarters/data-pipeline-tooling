"""Case Type ingest template rendered by ``pipelines.scaffold --case-type`` (#155).

The case-review-flavoured sibling of ``pipelines/_scaffold_template/``: a worked
starting point for a feed whose rows *are* a Case Type. Where the generic
template is source -> raw and deliberately case-review-agnostic, this one
declares the Case Type's **identity contract** (``natural_key`` -> derived
``namespace`` + deterministic ``case_id``, ADR-0009) and refines the feed through
the settled ingest spine: source -> raw -> silver.

It stops at silver on purpose. How accumulated silver is reduced/assembled into
gold (single-feed current reduce, multi-feed join, Detail Tables) is unique per
Case Type and is an open design decision (snapshot-vs-join — issue #163), so the
gold step is left to the feed author.

This placeholder feed is called ``myfeed``; the scaffold substitutes that token
(and its PascalCase class form ``Myfeed``) for the real feed name. It is a
*real, runnable* feed so its own ``test_myfeed.py`` runs in the suite and keeps
the template honest — see ``tests/pipelines/test_scaffold.py``.
"""
