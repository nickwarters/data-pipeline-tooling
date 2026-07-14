<!--
  CORA pull request template. Fill in the sections that apply and delete the
  rest — a one-line docs fix doesn't need a Verification table. Keep the
  headings you use so reviewers know where to look.
-->

Closes #<!-- issue number, or remove this line if there's no issue -->

## Problem

<!-- What's wrong or missing today, and why it matters. Be concrete. -->

## Change

<!--
  What you did, at a level a reviewer can scan. Use the CONTEXT.md domain
  terms exactly (Case Type, Question Definition, Applicable Question, Answer,
  Remediation Action, Reviewer, Responsible Party, Case Type Owner,
  Conversation, Outcome). Call out anything deliberately left out of scope.
-->

## ADR

<!--
  Non-trivial decisions trace back to an ADR (docs/adr/). If this PR makes or
  changes one, name it (e.g. "Adds ADR-00XX"; "evolves ADR-0011"). If it
  deviates from an existing ADR, say so explicitly and why. Remove this
  section if no architecture decision is involved.
-->

## Tests

<!--
  Red-Green-Refactor, 100% coverage is the standard. What behaviour is now
  covered, and where (tests/<subject>.test.js)? Note any contract/drift-guard
  tests you added or updated.
-->

## Verification

<!-- Delete rows that don't apply. -->

- [ ] `node --test` — all passing (state the count)
- [ ] `node --test --experimental-test-coverage` — new/changed lines covered
- [ ] `tsc --noEmit --checkJs --allowJs` (`npm run check`) — clean
- [ ] Exercised the change (mock loop `?mock=1`, in-memory flow runner, or a real deploy) where it has runtime behaviour

## Checklist

<!-- Confirm the repo's hard rules still hold (see CLAUDE.md). -->

- [ ] No third-party **runtime** dependencies added (dev/CI tooling is fine)
- [ ] No runtime build step introduced — source JS is deployed JS
- [ ] Components reach the network only through the `SharePointClient` interface — no direct `fetch()`
- [ ] No `innerHTML` for user data (`unsafeHTML()` only for narrowly reviewed markup)
- [ ] Custom elements keep the `cora-` prefix (element + CSS namespace)
- [ ] Question Definitions are deprecated via the `deprecated` flag, never deleted
- [ ] Docs updated where relevant (CLAUDE.md, CONTEXT.md, docs/PLAN.md, ADRs)
