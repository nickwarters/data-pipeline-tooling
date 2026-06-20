# Retrospective: the framework-design rabbit hole

This is a candid account of how the framework over-reached before commit
`1b8488b`, why, and what would have caught it sooner. It exists so the lessons
are enforced going forward (see
[ADR-0012](docs/adr/0012-keep-the-framework-domain-free.md)) rather than
rediscovered. It is written looking back from the lighter design we landed on:
**a DAG of generic steps, with business terms and logic removed from the
framework entirely.**

## What the detour looked like

Three artifacts capture it:

- **`CONTEXT.md` carried ~277 lines of business ontology** — Case, CasePool,
  SelectionPool, Selection trace, Variation, Question Bank, Review Outcome,
  Reference Data — with `_Avoid_` synonym lists and a worked domain dialogue.
  That is a *case-review domain model*, living next to what was meant to be a
  generic engine.
- **13 ADRs**, several stamped "**Decided; not yet built**" (the ADR-0006
  amendment, ADR-0009 fan-out and identity). Design kept racing ahead of code:
  the walking skeleton was issue #2, but the history reaches issue #183.
- **Four "ruthless cut" passes removed ~1,800 lines** — `recipes/medallion.py`,
  a 670-line `orchestration.py`, a 328-line `run_registry.py`, `retry`,
  `calendar`, bespoke processors (SplitColumn / JoinColumns / Zfill /
  IntegerText), an observability stack, "integrations" and "analytics" — and the
  final move was mechanically renaming **`case_type → subject`** to scrub the
  business noun out of the core.

The breakthrough commit, `1b8488b` ("explicit DAG composition and deprecate
Processor protocol"), replaced a rigid medallion *recipe* machine with a generic
DAG. The general, business-free abstraction was *smaller and more powerful* than
the rigid one it replaced.

## The three strands of the rabbit hole

### 1. The domain leaked into the framework

We built a generic engine and modeled the case-review business in the same
place, at the same time. `case_type`, `case_id`, `CasePool`, "gold grain = one
row per Case," and the identity contract became core concepts. The entire final
cleanup was prying them back out.

**What would have caught it:** a standing rule asked *before* anything entered
`framework/` — *"what in here would a completely different team, ingesting
completely different data, never want to know about?"* The answer (Case,
Selection, Reviewer) is exactly what got deleted. A primitive named after a
business noun is a primitive in the wrong package.

### 2. Designing for requirements that hadn't arrived

ADRs existed for Sync, Reporting, SAS-over-SSH, SharePoint writers, scheduled
orchestration, volume-anomaly guardrails, quarantine, and selection
explainability — almost all "decided, not yet built." Each speculative future
justified more machinery (the run registry, the orchestrator, the recipe layer),
which justified more structure.

**What would have caught it:** for each ADR, *"what breaks today if we DON'T
decide this now?"* If the answer is "nothing, we might refactor later," it is a
note, not an ADR. ADR-0005 ("progressive enhancement behind stable seams") was
right in principle, but the practice inverted it: we built the seams *and* the
enhancements speculatively. You may *name* a future seam; you may not *build
past* it until a second real consumer exists.

### 3. Vocabulary and structure ahead of substance

The `_Avoid_` lists, the flagged-ambiguities ledger, the six facades plus
`_internal` / `_cli` / `testing` packages, and tests mirroring every
sub-package were heavy investment in *organising* a system whose shape was
unproven. Hard naming debates (`Dataset` vs `CasePool` vs `DataHandle`) are a
tell: you only argue that hard about names for things you have over-committed to.

**What would have caught it:** *"is this elaboration earning its keep right now,
or are we polishing?"* Six facades before there were six things worth separating
is structure as procrastination.

## What we will do differently

These are the durable tripwires, most of them a single question asked earlier.
They are encoded as rules in [ADR-0012](docs/adr/0012-keep-the-framework-domain-free.md).

1. **No business nouns in `framework/`** — enforced from commit one. This one
   rule would have prevented the largest cut.
2. **Two real consumers before any abstraction** — recipe, facade, base class, or
   seam. One feed is not enough evidence.
3. **An ADR must name a requirement that breaks today** — otherwise it is a note.
   Re-classify by "breaks today" vs "might refactor later" and demote the second
   bucket.
4. **Build the walking skeleton end-to-end, then stop** — and let the second and
   third *real* feed pull features out of it. Features are pulled by a concrete
   pipeline that can't be written without them, not pushed by anticipation.
5. **Separate the domain glossary from the framework glossary, physically** — the
   case-review business belongs next to `case_review/`, not next to `framework/`.
6. **Treat doc volume as a smell, not a virtue** — 13 ADRs and a 277-line
   ontology for a CSV→raw skeleton is the rabbit hole made visible. When the docs
   describe far more than the code does, the design is ahead of the evidence.

## The meta-lesson

Nearly every cut reversed one of two things: **coupling the engine to the
business**, or **building ahead of demand**. Both are caught not by *more* design
rigor but by *less* — a couple of standing rules and the repeated question
*"what real, present requirement forces this right now?"* The DAG was reachable
on day one. What hid it was deciding too much, too early, in too much detail.
