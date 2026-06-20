---
status: accepted
---

# Keep the framework domain-free; let real feeds pull features

The `framework/` package is a **generic, business-free engine** for composing
data pipelines. It must not encode the case-review domain — or any domain — in
its names, primitives, or structure. Business vocabulary, recipes, and policy
live in the application layer (`case_review/`, `pipelines/`); the framework only
knows about generic shapes (`Dataset`, `Reader`, `Writer`, `Pipeline`, steps,
and a DAG that composes them).

This ADR exists because we learned the cost of the opposite stance the hard way.
An earlier arc baked the domain *into* the engine — `case_type` as a core
concept, a `CasePool`/identity contract in the framework, a rigid medallion
*recipe* layer, plus speculative orchestration, a run registry, retry, calendar,
and bespoke shaping processors — most of it "decided, not yet built." Unwinding
it took four "ruthless cut" passes (~1,800 lines removed) and a mechanical
`case_type → subject` rename to scrub the business noun back out of the core. The
lighter design we landed on — **explicit DAG composition of generic steps** — was
available from the start; deciding too much, too early, in too much detail is
what hid it.

## The rules

1. **No business nouns in `framework/`.** If a name only makes sense to someone
   who knows the case-review business (`Case`, `Selection`, `Reviewer`,
   `case_type`, `CasePool`), it belongs in the application layer. The framework
   speaks only in generic shapes. A primitive named after a domain concept is a
   primitive in the wrong package.

2. **Two real consumers before an abstraction.** Don't extract a recipe, facade,
   base class, or seam until a *second* actual caller needs it. One feed, one
   case type, or one hypothetical future is not enough evidence to generalise.

3. **An ADR must name a requirement that breaks *today*.** If the honest answer
   to "what breaks if we don't decide this now?" is "nothing, we might refactor
   later," it is a note, not an ADR. You may *name* a future seam (ADR-0005); you
   may not *build past* it speculatively.

4. **Features are pulled, not pushed.** A capability enters the framework because
   a concrete pipeline cannot be written without it — never in anticipation. The
   walking skeleton (#2) is the floor; the second and third *real* feed are what
   tell the framework what it actually needs.

5. **Domain glossary and framework glossary stay physically separate.** Domain
   vocabulary lives next to the application code it describes, not next to
   `framework/`. Mixing them in one place is what makes the coupling feel natural.

## Why

- Coupling the engine to one business is what every "ruthless cut" reversed.
  Forbidding business nouns at write time catches it in the diff, not 50 commits
  later.
- Building ahead of demand is what justified the orchestrator, run registry, and
  recipe layer that were later deleted. Pulling features from real feeds keeps
  the surface proportional to proven need.
- The generic, business-free abstraction (a DAG of steps) turned out to be both
  *smaller and more powerful* than the rigid, domain-aware recipes it replaced.
  Rigidity was buying coupling, not safety.

## Consequences

- A change that puts a business noun, recipe, or policy into `framework/` is a
  defect in the change, the same way stale docs are (see CLAUDE.md). The reviewer
  rejects it on sight; the home is `case_review/` or `pipelines/`.
- Some genuinely-needed generality will arrive a little later than it could have,
  on the second consumer rather than the first. That lateness is the price of not
  building the wrong abstraction, and it is cheaper than a rewrite.
- This ADR is a *gate on new ADRs*: a proposed decision that can't point at a
  present, failing requirement is demoted to a note until one appears.
- See [`RETROSPECTIVE.md`](../../RETROSPECTIVE.md) for the full account of the
  detour this ADR encodes the lessons from.
