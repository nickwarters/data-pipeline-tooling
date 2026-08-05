# Clean-room Case Review

The parallel Case Review route is:

```text
#/new_dashboard/:caseType/:id
```

It is intentionally small. `src/new-dashboard/new-dashboard.js` owns the page
state, rendering, and ETag-guarded writes. `case-model.js` owns the pure access,
applicability, failure, and Outcome rules.
`browser.js` supplies the retained `HttpSharePointClient`; the Case Type
variation comes from the shared data-only `case-types/complaints-data.js`
descriptor plus the existing Question Bank text artifact. The canonical module
adds its evaluator function separately; the clean re-export cannot drift from
the same data. The default answer-save debounce is **1500 ms**.

The route's transitive module graph is contract-tested. It may contain only the
explicitly retained transport, HTML helper, shared type contract, Case Type and
dev assets, and newly authored `src/new-dashboard/` modules. It must not reach
into the established page, router, store, evaluator, component, or service
framework.

## Implemented slice

- canonical route parsing, loading, missing/error states, and list-scoped reads;
- existing CORA navigation, Case header, tabs, hold and Conversation controls;
- read-only configured Case Details;
- Question Bank groups, response options, progress, and `showWhen` evaluation;
- one serial, coalescing 1500 ms save path for Answers, Notes, and Issue Capture,
  with ETags, lifecycle flushes, and visible saving/saved/conflict states;
- configured failure capture including justification, remediation actions,
  free-form action and Responsible Party search, with the handoff repeated in
  Summary and Remediation tracking;
- direct completion, Send Actions, Remediation resolution, and final close;
- Notes, namespaced General Questions, multi-choice and bulk group outcomes,
  Conversation, hold, and configured void-reason writes;
- reportable Question Bank snapshots with an explicit live-bank warning;
- remediation SLA dates using the maintained England and Wales holiday
  calendar, plus required details for non-complete resolutions;
- Journey Owner Appeal requests, Controls Appeal Review, and direct Outcome
  amendment;
- typed Issue Capture with conditional and required fields plus person search;
- relationship/group-derived edit and read-only modes, terminal freezing,
  wrapped keyboard tab navigation, unanswered-question jump, Alt+C, and a
  500-question render budget.

## Not yet parity-complete

The established route remains authoritative. The clean-room route still needs
browser-based responsive/light/dark visual comparison. Do not remove the old
route or describe `new_dashboard` as a replacement until that comparison is
closed.
