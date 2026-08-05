# 0047 — Build the clean-room Case Review on a parallel route

## Status

Accepted for incremental delivery.

## Decision

Build the ground-up Case Review at `#/new_dashboard/:caseType/:id` while the
existing `#/case/:caseType/:id` remains unchanged as the production oracle. The
new route uses only the explicitly retained HTML/CSS/SharePoint seams, Case Type
configuration and Question Banks, plus new clean-room modules. A transitive
module-graph test enforces that boundary.

The production and dev host entry chooses the new runtime only when the hash
starts with `#/new_dashboard/`; all other hashes load the established app.

## Consequences

Parity can be delivered as vertical TDD slices without destabilising current
users. Duplication is accepted temporarily across the two independent routes.
The old route cannot be removed until functionality, access, lifecycle,
performance and visual parity have all been demonstrated.
