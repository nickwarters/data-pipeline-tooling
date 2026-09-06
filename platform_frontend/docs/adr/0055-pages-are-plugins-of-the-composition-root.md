# 55. Pages are plugins of the composition root

Date: 2026-09-06

## Status

Accepted.

Builds on [ADR-0054](./0054-application-config-is-the-composition-root.md),
which made `src/app-config.js` the one place this application says what it is
made of, and moved the page list there.

**It does not supersede
[ADR-0042](./0042-static-page-imports.md).** That decision stands: pages are
statically imported, `#/question-bank` excepted, for the three reasons ADR-0042
gives. ADR-0054 already amended it to record that the file holding the imports
moved rather than that the imports changed kind. Nothing here reverses either.

## Context

ADR-0054 landed the page list in the composition root, and three things it did
not do were left over.

**Nothing declared the entry's shape.** Entries had a shape in practice —
`id`, `paths`, `page` or `load`, sometimes a `guard` — and nothing said so, so
nothing caught a malformed one.

**The nav decided its own links.** `components/sections/cora-app-nav.js` read
six capabilities by hand and implied the bar's order in the order of the `if`s
that read them. Which links a user gets is a property of what the application
is composed of, and it was stated in a second place, in a different vocabulary,
where nothing held the two in step.

**There was no landing resolution at all.** The nav's brand link was hardcoded
to `#/dashboard`, including for a viewer who could not open it, and a failed
route guard bounced to `#/`. "Dashboard for Reviewers, Search for Controls, My
Cases for Responsible Parties" was an objective nothing implemented.

## Decision

**A page is a plugin of the composition root, and everything that is true of it
is declared there once.**

```js
/**
 * @typedef {Object} PagePlugin
 * @property {string} id
 * @property {string[]} paths
 * @property {any} [page]                 statically imported — the default
 * @property {() => Promise<any>} [load]  the exception; one page has earned it
 * @property {(context: AppContext) => (() => Promise<any>) | undefined} [loadOverride]
 * @property {(capabilities: Capabilities) => boolean} [guard]
 * @property {{ label: string, order: number, isVisible?: (capabilities: Capabilities) => boolean }} [nav]
 * @property {(capabilities: Capabilities) => boolean} [defaultFor]
 * @property {number} [defaultForOrder]
 */
```

`setup/register-routes.js` is the engine. It holds no list and derives three
things from the one that exists: the routes the router registers, the items the
nav draws (`navItemsFor`), and where a user lands (`resolveDefaultLandingPath`).

### Every predicate takes `Capabilities`, and none of them redirects

This is what lets a nav item default its audience to the route's own `guard`
rather than restating it. Four of the eleven pages state their audience once for
both; the rest write `isVisible` because they have no guard to default from, and
two of those are honestly open routes with narrowed links — the Dashboard and
the Roadmap are not sensitive, and their comments say so.

It forced the bounce out of the predicate. A `guard` that redirected could not be
asked "draw this nav item?" without redirecting a user who was only looking at
the bar, so `bounceHome()` moved to the engine: a guard says whether, and the
engine decides what a `false` costs.

It also moved one guard's input. `#/journey-cases` guarded on
`context.journeyCaseSources` — the _resolved_ sources, which no capability
carries — and now reads `ownedJourneyCaseTypes`. The two differ only when an
owned Case Type's module failed to evaluate, a state the unavailable-Case-Type
banner already names, and an empty list beside that banner reads better than a
bounce with no reason attached.

### Landing is ranked, and a tie throws

```js
export const FALLBACK_LANDING_PATH = '#/';
```

Three rules exist: Dashboard for a Reviewer (rank 10), their own Case list for a
Responsible Party (20), the cross-Case-Type lookup for Controls (30). A user
matching several resolves by rank.

Rank rather than list order, because a landing page that fell out of `nav.order`
would move whenever someone reordered the bar — a number chosen for
left-to-right sorting deciding where people start their day. Rank rather than
first-match, because first-match hides precedence inside whichever predicate is
earlier: the draft this replaced expressed it as `&& !caps.isReviewer` inside
one of two rules, invisible from the other, which is the shape that shipped two
access bugs in the Section epic. **Two rules at the same rank throw**, naming
both ids, because a tie is a mistake in the list rather than something to pick
from.

The fallback is `#/` and not `#/dashboard`. `pages/home.js` already branches on
`isVisitor` — which is _derived_, true iff the user holds no capability at all —
so an unmatched viewer, and equally a user whose group did not resolve, gets the
guidance screen written for them rather than a dashboard they cannot use. `home`
therefore carries no `defaultFor`: it is the fallback, and being a rule as well
would make one page reachable two ways with two different precedences.

## Consequences

### The layering privilege stays one file

`tests/component-layering-contract.test.js` still permits exactly one file to
name a page module, and it is still `src/app-config.js`. Nothing here widened
it, and the nav — which named no page module before and names none now — is held
to that by a ratchet on its source.

### What is irreducible, and why

A page is: the page module, one `pagePlugins` entry, and nothing else. **That
entry cannot be removed.** [ADR-0041](./0041-deployed-bytes-are-source-bytes.md)
bans a build step, so nothing can discover modules at runtime, and a module must
be named somewhere to be loaded. It is the same file, and the same reason, that
names a Section.

Writing that down is the point: the config entry reads like leftover coupling to
anyone who has not hit the constraint, and two attempts to remove that shape are
what produced ADR-0054 and this ADR in turn.

### Failure is contained differently on the two paths

`registerRoutes()` catches per entry, so one bad route costs one route and is
logged. A nav entry that throws is **not** caught: the nav's failure is already
fatal and visible through the boot error panel, and catching per entry would
drop one link silently — and a missing nav item is indistinguishable from "you
do not have permission to see that", which is the failure this application named
a banner after.

### Two routes gained a guard

`#/my-team` and `#/question-bank` had a nav item narrower than their route, so
anyone with the URL could open a page the bar never offered them. Both are
guarded now, to exactly their link's audience. **This closes a UX
inconsistency, not a hole**: client-side gating is UX-only here, and what
protects Case allocation and a Question Bank is the SharePoint list ACL. Hiding
a link makes nothing safe.

The Question Bank's audience also widened to Maintainers, who own the banks
across every Case Type and had no link to the editor at all.

### What this ADR does not claim

- **No page moved.** `src/features/<name>/` was considered and declined: with
  static imports working and the layering contract satisfied, it buys cohesion
  rather than correctness, and it would have cost a contract test that names
  `src/pages/question-bank/` by path, a root-repository pre-commit hook that
  reads `dev/fixtures/my-stats/`, and either the layering exemption for
  `src/sections/**` or a dozen Case Review sibling views moving with their page.
- **Three Case-list pages gained no nav item.** `#/team-cases`, `#/my-cases` and
  `#/journey-cases` have no link today and have none now; adding them would have
  changed every persona's bar, which every ticket in the phase forbade.
- **`register-routes.js` kept its name.** It now does more than its name says,
  and its header comment says what it is instead. A rename was weighed against
  churning documentation that had just been brought into step, and lost.
