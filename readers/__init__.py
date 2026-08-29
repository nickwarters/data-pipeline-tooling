"""Shared Reader contracts for cross-subject datasets.

Subject wrappers own storage resolution and consumers pass ``base_dir``.
Parameterized dataset families may expose a store, such as
``readers.question_banks.QuestionBankStore``, that mints scoped Readers.
Readers pass rows through; consumers own validation and freshness policy.
"""
