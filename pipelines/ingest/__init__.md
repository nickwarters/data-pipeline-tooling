```python
"""The demo's ``ingest`` pipeline: a Case Type's source feed landed to gold.

A path-addressed pipeline (``python -m cli run pipelines/ingest``): one
directory, a canonical ``pipeline.py`` exposing ``run(context)``. It also owns
the demo Case Type (:data:`~pipelines.ingest.pipeline.CASES`), which the
downstream ``selection`` pipeline imports — mirroring the real upstream edge.
"""

```
