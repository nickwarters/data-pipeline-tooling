# Tabbed case review layout

> The **Remediation** tab is now a
> distinct _tracking_ Section (per-action complete/cancelled), split from **Issues**
> capture; **Amend Outcome** is a case-level Controls surface;
> two appeal tabs — **Appeal Request** and **Appeal Review** — are added. The
> persistent-chrome Complete button now flips label between **"Send Actions"** and
> **"Complete Case"**. Tabs a viewer can't access still render no tab,
> so the visible tab set differs by role.
> [the architecture decision]:./0024-remediation-tracking-tab.md
> [the architecture decision]:./0026-amend-outcome-case-level-and-qa-retirement.md
> [the architecture decision]:./0027-appeal-flow-journeyowner-controls.md

The case review page presents its **Section**s as tabs instead of one long scroll. **Case Details** is a new sixth Section and the default tab; the tab row is **Details · Questions · Remediation · Outcome · Notes**. Tabs are rendered by a generic, domain-free `cora-tabs` primitive (label list + selected id + ARIA roles + arrow-key nav, emits `cora-tab-change`); `cora-case-review.js` owns the Section→tab mapping, the access-driven visibility, and the default/fallback selection.

## Two deliberate exclusions

- **Conversation is not a tab.** It stays a floating overlay toggled from the persistent chrome (`Alt+C`). Tabs are mutually exclusive, but the core review loop needs the **Conversation** readable _alongside_ the Questions — a Reviewer reads what the Responsible Party said while answering. Making it a tab would force read-then-switch and lose that context. The persistent chrome therefore holds the save-status banner, the Conversation toggle, and the "Complete Case" button (a Case-level action reachable from any tab) — none of which belong inside a single tab panel.
- **The active tab is not in the URL.** Tab state is an in-component `signal`. Per the architecture decision the router remounts the whole route on every `hashchange`, which would refetch the Case and discard the in-memory answers signal and any un-flushed auto-save on each tab click. In-component state sidesteps that; the cost is no deep-linking to a tab and Back exits the Case rather than cycling tabs — acceptable for a Reviewer working one Case top-to-bottom.

## Visibility

A Section that resolves to `hidden` for the viewer renders **no tab**. The default tab is **Details** (read-only for all roles, never hidden); if absent for a Case Type, it falls back to the first visible tab in Section order. The existing all-Sections-hidden short-circuit still renders the access-denied panel, so at least one visible tab is guaranteed past that point.

## Considered alternatives

- **Conversation as a tab, like every other Section.** Rejected: uniform but breaks the answer-while-reading loop the popover was built for.
- **URL-driven tabs** (`#/case/:id/:tab` or `?tab=`). Rejected for this slice: would require changing the router to treat a same-`:id` change as an in-place update rather than a remount — a deviation from the architecture decision with its own trade-off. Revisit if deep-linkable tabs are wanted.
- **A review-specific `cora-case-tabs` component.** Rejected: name already taken (Question Bank's Case Type switcher) and it would bury access/visibility logic in the tab widget. Domain logic stays in the page; the tab primitive stays dumb and reusable.

## Scope

The **Case Details** data model — where the type-specific field _values_ live (likely a `details` JSON blob on the Case row per the architecture decision) and how each **Case Type** _declares_ its fields (per the architecture decision) — is explicitly **out of scope** here. This slice ships the tab shell; Details renders today's header content (title, reviewer, status, dates) until the data model lands in a follow-on slice.
