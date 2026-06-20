"""Case Type ingest template rendered by ``python -m cli scaffold --case-type``.

The case-review-flavoured sibling of the generic feed template: a worked
starting point for a feed whose rows are Cases. Where the generic template is
source -> raw and deliberately case-review-agnostic, this one declares the Case
Type's identity contract and refines the feed through source -> raw -> silver.

It stops at silver on purpose. How accumulated silver is reduced/assembled into
gold (single-feed current reduce, multi-feed join, Detail Tables) is unique per
Case Type, so the gold step is left to the feed author.

This placeholder feed is called ``myfeed``; the scaffold substitutes that token
(and its PascalCase class form ``Myfeed``) for the real feed name. It is a
*real, runnable* feed so its own ``test_myfeed.py`` runs in the suite and keeps
the template honest.
"""
