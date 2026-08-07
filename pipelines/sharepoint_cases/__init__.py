"""Ingest feed for one Case Type's SharePoint list, source -> raw -> silver -> gold.

Polls the list by its ``Modified`` window and lands each observation twice: raw
in SharePoint's own column names, silver snake_cased, typed and validated. Both
are append-only histories of immutable source versions. Gold reduces that
history to the current Case and three aggregates, rebuilt whole on every poll,
and the polling watermark is committed only once all four have landed.
"""
