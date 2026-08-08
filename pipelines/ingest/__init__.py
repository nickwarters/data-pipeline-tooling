"""The demo's ``ingest`` pipeline: a Case Type's source feed landed to gold.

A path-addressed pipeline (``python -m cli run pipelines/ingest``): one
directory, a canonical ``pipeline.py`` exposing ``run(context)``. Its
``schema.py`` owns the demo feed's row schema, identity values, and Variations;
the downstream ``selection`` pipeline imports those declarations directly.
"""
