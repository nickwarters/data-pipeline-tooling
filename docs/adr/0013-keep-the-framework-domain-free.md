---
status: accepted
---

# Keep the framework domain-free; let real feeds pull features

The `framework/` package is a **generic, business-free engine** for composing data
pipelines. It does not encode the case-review domain — or any domain — in its
names, primitives, or structure. Business vocabulary, recipes, and policy live in
the application layer (`case_review/`, `pipelines/`); the framework knows only
generic shapes (`Dataset`, `Reader`, `Writer`, `Pipeline`, nodes, and the DAG that
composes them — ADR-0003).

This is the load-bearing constraint behind the framework's lean shape. The
[`RETROSPECTIVE.md`](../../RETROSPECTIVE.md) records why it has to be a rule and
not a preference: an earlier arc baked the domain *into* the engine and built
ahead of demand, and the generic DAG we now have turned out to be both *smaller and
more powerful* than the domain-aware recipe machine it replaced. These rules exist
so that lesson is enforced going forward rather than rediscovered.

## The rules

1. **No business nouns in `framework/`.** If a name only makes sense to someone who
   knows the case-review business (`Case`, `Selection`, `Reviewer`, `case_type`,
   `CasePool`), it belongs in the application layer. The framework speaks only in
   generic shapes. A primitive named after a domain concept is a primitive in the
   wrong package.

2. **Two real consumers before an abstraction.** Don't extract a recipe, facade,
   base class, or seam until a *second* actual caller needs it. One feed, one case
   type, or one hypothetical future is not enough evidence to generalise.

3. **An ADR must name a requirement that breaks *today*.** If the honest answer to
   "what breaks if we don't decide this now?" is "nothing, we might refactor
   later," it is a note, not an ADR. You may *name* a future seam (ADR-0011); you
   may not *build past* it speculatively.

4. **Features are pulled, not pushed.** A capability enters the framework because a
   concrete pipeline cannot be written without it — never in anticipation. The
   walking skeleton is the floor; the second and third *real* feed are what tell the
   framework what it actually needs.

5. **Domain glossary and framework glossary stay physically separate.** Domain
   vocabulary lives next to the application code it describes, not next to
   `framework/`. Mixing them in one place is what makes the coupling feel natural.

## Why

- Coupling the engine to one business is the failure these rules reverse. Forbidding
  business nouns at write time catches it in the diff, not fifty commits later.
- Building ahead of demand is what justifies machinery that later has to be deleted.
  Pulling features from real feeds keeps the surface proportional to proven need.
- The generic, business-free abstraction (a DAG of steps) is both smaller and more
  powerful than the rigid, domain-aware recipes it would replace. Rigidity buys
  coupling, not safety.

## Consequences

- A change that puts a business noun, recipe, or policy into `framework/` is a
  defect in that change, the same way stale docs are (see CLAUDE.md). The home is
  `case_review/` or `pipelines/`.
- Some genuinely-needed generality arrives a little later than it could have — on
  the second consumer rather than the first. That lateness is the price of not
  building the wrong abstraction, and it is cheaper than a rewrite.
- This ADR is a **gate on new ADRs**: a proposed decision that can't point at a
  present, failing requirement is demoted to a note until one appears.
</content>
