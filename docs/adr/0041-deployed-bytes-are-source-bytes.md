# 41. Deployed bytes are source bytes: no transform step, leaf-first upload order

Date: 2026-07-29

## Status

Accepted — extends
[ADR-0001](./0001-target-sharepoint-se-and-edge-chromium.md), which chose
SharePoint SE and Edge Chromium as the baseline that makes shipping raw source
viable in the first place. It also promotes into the ADR record a hard rule that
until now lived only in CLAUDE.md.
[ADR-0004](./0004-case-type-config-as-js-modules.md),
[ADR-0005](./0005-jsdoc-with-tsc-typecheck.md) and
[ADR-0034](./0034-store-driven-views-supersede-component-owned-state.md) restate
the rule in passing and keep their original wording; this ADR is the pointer.

## Context

The rule has always been **"no build step at runtime; source JS is deployed
JS"**. Aimed at bundlers and transpilers it worked, but read literally it bans
_any_ tooling between commit and upload — including work nobody objects to:
verifying that what landed in the Style Library is what left the repository,
hashing the tree, walking the module graph to decide an upload order. The repo
already accepts a category of tool that gates the repository without touching a
deployed byte — tsc, prettier, eslint, husky, lint-staged. None produce code;
they read it and refuse. This decision extends that category across the deploy
boundary, and draws the fence tighter than "no build step" ever did, because
"build" is a word a determined PR can argue about and "byte-identical" is not.

**There is no working automated deploy today**, so none of the ordering below
runs yet: `build_client()` in `scripts/deploy_to_sharepoint.py` raises
`NotImplementedError`, `run()` catches it only on the dry-run path, and every
deploy is `--dry-run` plus a hand-upload. The ordering it _would_ use:
`compute_plan()` returns `adds`, `updates` and `deletes`, each sorted by
target-relative POSIX path, and `execute_plan()` uploads `adds`, then
`updates`, then applies deletes. **Deletes are already last** — existing
behaviour, not something this ADR introduces. The gap is inside `updates`:
`src/core/x.js` importing `src/lib/y.js`, both changed, uploads
importer-before-dependency purely because `core` sorts before `lib`, and for
that window a browser can fetch the new importer and 404 on the leaf it needs.
Adds all precede updates, so a brand-new leaf lands before its existing importer
— luck that inverts the moment a leaf is renamed into an add while its importer
stays an update. Decision 2 sets the ordering a future deploy client must
honour. It changes no observed behaviour and fixes no observed incident.

## Decision

### Decision 1 — the rule is "no transform step"

The invariant is categorical and has two tiers.

**(a) Every byte of every deployed file, whatever its suffix, is byte-identical
to the byte in the repository.** The set is wider than `.js` and `.css`:
`DEFAULT_INCLUDE_SUFFIXES = (".js", ".css", ".html", ".aspx")` under the include
roots, plus the `case-types/banks/*.txt` Question Bank artifacts via the scoped
`BANKS_DIR` special case. Tier (a) covers all of it, so a future "compile the
Question Bank at deploy time" step fails this ADR exactly as a bundler does. No
exceptions, ever. **No tool produces code**, and committing the generated output
does not satisfy tier (a) — the repository byte must itself be the authored
byte.

**(b) Templated files are the single carve-out.** The only permitted deploy-time
operation anywhere in the tree is literal replacement of a fixed, enumerated set
of `{{TOKEN}}` placeholders with deploy-target values. `TEMPLATED_SUFFIXES =
(".html", ".aspx")`, so substitution applies to _any_ `.html`/`.aspx` file in
the include roots — today only `host/index.html`, but a newly added one joins
silently. Two bounds matter, and both are hard: the token set — today `{{CORA_BASE}}` and
`{{CORA_ENV}}`, substituted by `render_templated_files()` before hashing — and
the suffix set. Substitution is confined to `.html`/`.aspx`; extending
`TEMPLATED_SUFFIXES` to reach a module is import rewriting wearing a template's
clothes. No expression evaluation, no conditional inclusion, no content
generation, and no new token or suffix without superseding this ADR. The host page is _inside_ the deployed tree
(`host/` is a `DEFAULT_INCLUDE_ROOTS` entry), whereas `SitePages/app.aspx` is a
hand-maintained Content Editor page no include root produces and the script
never touches.

**Banned:** bundling, minification, transpilation, import rewriting, source
maps, generated modules — not by being listed, but because each fails tier (a);
the list is illustrative, tier (a) is the rule. **Permitted:** verification,
hashing, module-graph analysis, upload ordering, preflight aborts, post-upload
comparison — every one read-only over the bytes. Changing this invariant
supersedes an accepted decision; it is not a reinterpretation of one.

### Decision 2 — graph-derived leaf-first upload order

**Uploads are topologically ordered: dependencies before dependents, host page
last.** Deletes continue to run after all uploads — existing behaviour, retained.

An ESM-specifier-only scanner would miss most of this codebase's real edges. The
graph is defined by a rule, not an inventory — an inventory goes stale the next
time a page adds a thunk, while reading as complete. It must include:

- every **static `import` specifier** in the deployed set;
- every **dynamic `import()` call site** in the deployed set — the well-known
  families in `src/setup/` and `case-types/manifest.js`, but page-local thunks
  too (`cora-bank-editor.js` → `question-bank-samples.js` is an illustration,
  not the list);
- `host/index.html` → its stylesheets and `src/app.js`;
- the CSS `@import` of `cora-design-tokens.css` from `cora-styles.css`;
- the runtime data edge `case-types/load-bank.js` → `banks/{slug}.txt`.

Two resolution rules, without which the graph is undefined:

- The graph is built over **the deployed file set only**. A specifier resolving
  outside the include roots — `dev/fixtures/*`, reached from
  `create-sharepoint-client.js` — is dropped, not treated as an error.
- **Bare specifiers are never path-resolved** (`node:fs/promises` and friends).

`case-types/complaints.js` awaits `loadBank('./banks/complaints.txt')` at top
level, so the `.txt` is a dependency of module _evaluation_, not a lazily
fetched asset. A missing or stale bank makes the Case Type module throw while it
is evaluated, and `loadCaseTypeSources()` contains exactly that by dropping the
Case Type entirely. The failure therefore degrades to "you appear to have no
Cases" rather than to a visible error — the worst possible shape for a
deploy-window fault.

What leaf-first buys, stated plainly: it removes **dangling references** — a
live file importing a file not uploaded yet. It does not remove **mixed-version
graphs**. When a leaf and its importer are both in `updates`, some per-file
order must exist, and every one leaves a window in which a user loads the new
importer against the old leaf.

## Alternatives considered

**Versioned release folders (`CODE/CORA/rNNN/`, host page repointed last).**
Stronger, and rejected for now rather than on merit: it is the only option that
makes the cutover atomic — a release uploads into a fresh folder nothing
references, and one edit to the host page's asset base switches every user at
once, closing the mixed-version window as well as the dangling-reference one.
The costs are real: it multiplies the [ADR-0033](./0033-uat-environment.md)
environment surface, needs a retention and rollback policy for old `rNNN`
folders, and needs a manual Content Editor repoint every release precisely
because `SitePages/app.aspx` sits outside the script's management. None of that
is justifiable before an automated deploy client exists at all. The door stays
open: if a mixed-version incident is ever observed, this is the recorded answer.

**Do nothing.** Keep the sorted order. Rejected — it makes correctness a
property of alphabetical accident, and the bank-artifact failure mode is
invisible when it fires.

**Upload to a temp folder, then rename.** Rejected: SharePoint SE folder moves
are not atomic across a library, and this deploy is a diff sync rather than a
full copy, so there is no complete tree in the temp folder to rename.

**Maintenance window / off-hours deploy.** Rejected: procedural and
unenforceable, and it does not survive the automated pipeline that this ADR
exists to make possible.

## Consequences

- Deploy verification and graph-ordered upload work is now fenced rather than
  blocked. Post-upload hash comparison becomes the proof of the tier (a)
  invariant rather than merely a health check.
- CLAUDE.md's hard rule and the PR checklist are reworded to match.
- **Client-side caching bounds nothing.** A browser already holding the old
  `src/lib/y.js` keeps using it regardless of upload order, and there is no
  cache-busting query anywhere in the tree. Adding one would itself be import
  rewriting, banned by Decision 1.
- **The sync has no atomicity.** `execute_plan()` deliberately lets a failure
  propagate mid-plan, so a crashed deploy leaves a partial tree. Leaf-first
  shortens the window in which that tree is broken; it does not prevent one.
- `scripts/deploy_to_sharepoint.md` is not a runbook but a stale verbatim copy
  of an older version of the `.py`; regenerate or delete it rather than
  hand-editing it into further divergence.
- An edge inventory would also catch broken asset references: `host/index.html`
  links `{{CORA_BASE}}/src/question-bank/cora-question-bank-editor.css` while
  the file lives at `src/pages/question-bank/cora-question-bank-editor.css`, so
  that stylesheet would 404 in prod — a class of defect nothing but the browser
  currently checks.
