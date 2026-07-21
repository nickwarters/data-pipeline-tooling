# Delivery plan status

The original slice-by-slice build plan is retired. It described the route to a
framework that has now shipped and included authoring mechanisms that are no
longer part of CORA.

Use these sources instead:

- [CLAUDE.md](../CLAUDE.md) describes the shipped architecture and directory
  layout.
- [Add a store-driven page](guide/add-a-page.md) is the one-page developer
  onboarding path.
- [Architecture decisions](adr/) record current decisions and the history they
  supersede or amend.
- [CONTEXT.md](../CONTEXT.md) owns domain language.
- GitHub issues and milestones own remaining delivery work and sequencing.

The permanent application model is captured by ADR-0034, ADR-0035, and ADR-0036:
route state feeds pure `h()` views, events dispatch actions, effects cross
external boundaries, data-only Case Type descriptors express genuine Case Type
variation, and dashboard composition remains dashboard-owned.
