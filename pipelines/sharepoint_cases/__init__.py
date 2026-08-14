"""Ingest feed for one Case Type's SharePoint list, source -> raw -> silver -> gold.

Polls the list by its ``Modified`` window and lands each observation twice: raw
in SharePoint's own column names, silver snake_cased, typed and validated --
plus, one level further down, the ``answer``, ``answer_capture`` and
``answer_action`` Detail Tables exploded from each observation's ``answers``
JSON map. All are append-only histories of immutable source versions. Gold
reduces that history to the current Case, its Detail Tables and three
aggregates, rebuilt whole on every poll, and the polling watermark is
committed only once every gold table has landed.
"""
