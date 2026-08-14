"""Ingest feed for one Case Type's SharePoint list, source -> raw -> silver -> gold.

Polls the list by its ``Modified`` window and lands each observation twice: raw
in SharePoint's own column names, silver snake_cased, typed and validated --
plus, one level further down, six Detail Tables exploded from each
observation's JSON blobs: ``answer``, ``answer_capture``, ``answer_action``
and ``general_answer`` from the ``answers`` map, and ``conversation_message``
and ``appeal`` from the ``conversation`` and ``appeals`` lists. All are
append-only histories of immutable source versions. Gold reduces that history
to the current Case, its Detail Tables and three aggregates, rebuilt whole on
every poll, and the polling watermark is committed only once every gold table
has landed.
"""
