"""The demo's ``selection`` pipeline: the CasePool narrowed to a SelectionPool.

A path-addressed pipeline (``python -m cli run pipelines/selection``) that
declares ``ingest`` as a freshness upstream. It imports the demo Case Type from
the upstream ``ingest`` pipeline, mirroring the real dependency edge.
"""
