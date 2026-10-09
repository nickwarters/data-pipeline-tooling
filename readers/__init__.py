"""Shared Reader contracts for cross-subject datasets.

Subject wrappers own storage resolution. A consumer passes ``base_dir`` and,
for a reader over a table, optionally the keyword-only ``columns`` it needs,
which narrows what is fetched (ADR-0033). Parameterized dataset families may
expose a store, such as ``readers.question_banks.QuestionBankStore``, that
mints scoped Readers. Readers pass rows through; consumers own validation and
freshness policy. The guardrails (G1-G6) are in ``docs/shared-readers.md``.
"""
