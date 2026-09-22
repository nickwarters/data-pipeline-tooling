---
status: accepted
---

# Configurable quota selection is an opt-in utility

## Context

Some selection flows need absolute targets for attribute combinations, surplus
redistribution, progressively broader matches and a boolean balance within a
fixed boundary. These rules need reusable code with application-owned data.

## Decision

Provide `SelectionGroup` and `select_cases` in the sibling `tools.selection`
module. The input is an already eligible `Dataset`; output includes the selected
Dataset, a per-input trace and quota/group reports. Application pipelines own
the declarations, eligibility, input ordering and persistence.

Group targets are absolute, detailed targets sum to their group target and the
overall target is derived. Ordered dimensions define fallback by removing the
rightmost column. Boundary matches are never relaxed; groups cannot overlap.
Exact quotas are protected before redistribution to listed combinations, then
fallback. Volume and allocated specificity precede boolean balancing; True
receives the extra place for an odd achieved total. Quota declaration order
resolves competing deficits, and input order resolves remaining case ties.

The implementation balances through case exchanges that preserve allocated
match requirements. It does not introduce a general solver, configurable policy
hierarchy or framework primitive. Counts and reports make shortages explicit.

## Relationship to existing policy

This adds an opt-in algorithm, not a replacement for ADR-0021's group-level,
whole-eligible-pool planning, Hopper, oldest-first and void-replacement policy,
nor ADR-0022's person-targeted selection. No existing pipeline is migrated.
An algorithm's attribute boundary is a quota group within a calling pipeline;
it need not correspond to the application's cross-Case-Type Selection group.

## Consequences

Applications can share allocation code while supplying different attributes and
absolute counts. They must explicitly choose this algorithm and persist its
trace; framework explainability does not automatically capture these decisions.
Group shortages remain local, so actual overall volume can be below the sum of
targets. Balance is closest feasible for allocated slots, not a license to
weaken specificity. Full usage and report semantics are in
[`../quota-selection.md`](../quota-selection.md).
