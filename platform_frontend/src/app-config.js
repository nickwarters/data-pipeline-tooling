// src/app-config.js
// @ts-check

/**
 * The composition root: the one place this application says what it is made of.
 *
 * The library names nothing. A Section exists because this file imports its
 * module and lists it here, and the engine in `sections/registry.js` is handed
 * that list at boot — which is what makes an application-added Section
 * indistinguishable from a built-in one, rather than something bolted onto a
 * framework list it cannot edit.
 *
 * The same holds for a page: `setup/register-routes.js` registers what it is
 * handed and names no page module, so the route table and the Section list are
 * two entries in one file rather than two files that each know part of the
 * answer to "what is this application?".
 *
 * The order of `sectionPlugins` carries no meaning. The two orders that do are
 * each plugin's own `tabOrder` and `summaryOrder`, which the tab strip and the
 * Summary sort by; both accept fractional values, so a Section slots between
 * two others without renumbering them. `pagePlugins` is different: its order is
 * the registration order.
 *
 * `sectionPlugins` is `const`-asserted so each plugin's literal `id` survives
 * inference — that is what lets `Section` below be projected from the
 * composition rather than restated in a second table. Do not annotate that
 * array with a widening `@type`: `readonly SectionPlugin[]` turns every `id`
 * into `string` and the union silently becomes `string`, which type-checks
 * everywhere and checks nothing. Each plugin's conformance to the contract is
 * asserted by its own `@satisfies`, so the shape is not unguarded.
 */

import { DetailsPlugin } from './sections/details/details-plugin.js';
import { QuestionsPlugin } from './sections/questions/questions-plugin.js';
import { IssuesPlugin } from './sections/issues/issues-plugin.js';
import { SummaryPlugin } from './sections/summary/summary-plugin.js';
import { RemediationPlugin } from './sections/remediation/remediation-plugin.js';
import { NotesPlugin } from './sections/notes/notes-plugin.js';
import { ConversationPlugin } from './sections/conversation/conversation-plugin.js';
import { AppealRequestPlugin } from './sections/appeals/appeal-request-plugin.js';
import { AppealReviewPlugin } from './sections/appeals/appeal-review-plugin.js';
import { AmendOutcomePlugin } from './sections/amend-outcome/amend-outcome-plugin.js';
import { SecondReviewPlugin } from './sections/second-review/second-review-plugin.js';

import { CASE_TYPE_ENTRIES } from '../case-types/entries.js';

import * as homePage from './pages/home.js';
import * as dashboardPage from './pages/cora-dashboard.js';
import * as myStatsPage from './pages/cora-my-stats.js';
import * as teamStatsPage from './pages/cora-team-stats.js';
import * as caseReviewPage from './pages/cora-case-review.js';
import * as teamCasesPage from './pages/cora-team-cases.js';
import * as responsiblePartyPage from './pages/cora-responsible-party-dashboard.js';
import * as journeyCasesPage from './pages/cora-journey-cases.js';
import * as roadmapPage from './pages/roadmap.js';
import * as myTeamPage from './pages/cora-my-team.js';
import * as caseSearchPage from './pages/cora-case-search.js';

/** @typedef {import('./setup/register-routes.js').AppContext} AppContext */
/** @typedef {import('./setup/register-routes.js').PagePlugin} PagePlugin */
/** @typedef {import('./services/permissions.js').Capabilities} Capabilities */

/**
 * Whether this user holds any working role at all.
 *
 * The audience for the two links that are not about one job in particular —
 * the Dashboard and the Roadmap. Controls are in it: without them a
 * Controls-only account reached no nav item at all, not even the Dashboard.
 *
 * @param {Capabilities} caps
 * @returns {boolean}
 */
function hasAnyRole(caps) {
  return (
    caps.isReviewer ||
    caps.isAdviser ||
    caps.isReviewerManager ||
    caps.ownedCaseTypes.length > 0 ||
    caps.isControls
  );
}

export const APP_CONFIG = {
  /**
   * `const`-asserted here and nowhere else in this file. The Section id union
   * is projected from these literals, so a widening annotation on this array
   * erases them; `pagePlugins` below projects nothing, so it is typed against
   * its contract in the ordinary way.
   */
  sectionPlugins: /** @type {const} */ ([
    DetailsPlugin,
    QuestionsPlugin,
    IssuesPlugin,
    SummaryPlugin,
    RemediationPlugin,
    NotesPlugin,
    ConversationPlugin,
    AppealRequestPlugin,
    AppealReviewPlugin,
    AmendOutcomePlugin,
    SecondReviewPlugin,
  ]),

  /**
   * The Case Types this application has, held as thunks — and that asymmetry
   * with the two lists above is deliberate. A Section plugin and a page module
   * are cheap and needed at boot, so they are static imports; a Case Type
   * config is expensive and needed on demand, and its `slug` and `displayName`
   * have to be readable without evaluating it at all, because the
   * boot-critical synchronous permissions config composes three SharePoint
   * group names from the display name. Do not fold the three into one shape.
   *
   * Declared in `case-types/entries.js` rather than inline here, because
   * `case-types/manifest.js` derives from the same declaration and cannot
   * reach this file: the Section and page imports above lead back to it
   * through the services, and a manifest that imported the config would read
   * it mid-evaluation and fail boot.
   *
   * @type {readonly import('../case-types/manifest.js').CaseTypeEntry[]}
   */
  caseTypes: CASE_TYPE_ENTRIES,

  /**
   * Every hash this application answers, and the page behind it.
   *
   * Each page is a static `import`, which is what keeps the deployed bytes the
   * source bytes and boot one graph rather than a serial chain of round trips.
   * `#/question-bank` is the single exception and keeps its thunk: it is the
   * largest subsystem in the app, only a Maintainer ever opens it, and the
   * thunk is the seam the dev/mock harness swaps — which is why the descriptor
   * carries `loadOverride` as well as `load`, so that seam survives without the
   * route engine hand-writing an entry for one page.
   *
   * Array order is the registration order, and the only order here that means
   * anything: the nav sorts by each entry's own `nav.order` and the landing
   * rules by `defaultForOrder`.
   *
   * Every predicate here is a pure function of `Capabilities`. A guard that
   * redirected could not also answer "draw this nav item?", and the engine owns
   * the bounce for exactly that reason — so a page states its audience once.
   *
   * @type {readonly PagePlugin[]}
   */
  pagePlugins: [
    // Deliberately no `defaultFor`. `#/` is the fallback every unmatched
    // viewer already reaches, and home branches on `isVisitor` to render the
    // guidance written for exactly that person. A rule here would make the
    // same page reachable two ways with two different precedences.
    { id: 'root', paths: ['#/'], page: homePage },
    {
      id: 'dashboard',
      paths: ['#/dashboard'],
      page: dashboardPage,
      // An open route with a narrowed nav item: the link is for people with a
      // job here, but nothing stops anyone opening the URL.
      nav: { label: 'Dashboard', order: 10, isVisible: hasAnyRole },
      // A Reviewer's day starts on the Dashboard, and takes the first rank:
      // someone who reviews and also advises or reads across Case Types is
      // here to review.
      defaultFor: (caps) => caps.isReviewer,
      defaultForOrder: 10,
    },
    {
      id: 'my-stats',
      paths: ['#/my-stats'],
      page: myStatsPage,
      guard: (caps) => caps.isReviewer,
      // isVisible omitted: the audience for the link is the audience for the
      // route, and saying it twice is two declarations of one fact.
      nav: { label: 'My Stats', order: 30 },
    },
    {
      id: 'team-stats',
      paths: ['#/team-stats'],
      page: teamStatsPage,
      guard: (caps) => caps.isReviewerManager,
      nav: { label: 'Team Stats', order: 40 },
    },
    {
      id: 'question-bank',
      paths: ['#/question-bank'],
      load: () => import('./pages/question-bank/cora-bank-editor.js'),
      loadOverride: (context) => context.loadQuestionBankEditor,
      // Guarded as well as linked, and the two say it once. The link was a
      // Case Type Owner's while the route was open, so anyone with the URL
      // could open the editor; that is UX inconsistency rather than a hole —
      // the SharePoint list ACLs are what actually protect a bank — but a
      // link narrower than its route is worth closing while both are being
      // declared in one place. Maintainers are in it: they own the banks
      // across every Case Type and had no link to the editor at all.
      guard: (caps) => caps.ownedCaseTypes.length > 0 || caps.isMaintainer,
      nav: { label: 'Question Bank', order: 50 },
    },
    {
      id: 'case',
      paths: ['#/case/:caseType/:id', '#/case/:id'],
      page: caseReviewPage,
    },
    { id: 'team-cases', paths: ['#/team-cases'], page: teamCasesPage },
    {
      id: 'my-cases',
      paths: ['#/my-cases'],
      page: responsiblePartyPage,
      // A Responsible Party's own queue is where their day starts. Ranked
      // behind the Reviewer rule and ahead of Controls: precedence between the
      // three lives in these numbers and nowhere else, so no predicate has to
      // negate another one to express it.
      defaultFor: (caps) => caps.isAdviser,
      defaultForOrder: 20,
    },
    {
      id: 'journey-cases',
      paths: ['#/journey-cases'],
      page: journeyCasesPage,
      // List-scope Journey Owner capability: only a user who owns at least one
      // Case Type as a Journey Owner may see this view. Read off the
      // capability rather than off the RESOLVED sources, which differ only
      // when an owned Case Type's module failed to evaluate — a state the
      // unavailable-Case-Type banner already names, and one where an empty
      // list beside that banner reads better than a bounce with no reason.
      guard: (caps) => caps.ownedJourneyCaseTypes.length > 0,
    },
    {
      id: 'roadmap',
      paths: ['#/roadmap'],
      page: roadmapPage,
      // The other honestly-differing pair: the route is deliberately open to
      // anyone with the URL — a roadmap is not sensitive — while the link is
      // for people with a job here, so `isVisible` is written out rather than
      // defaulted from a guard this page does not want.
      nav: { label: 'Roadmap', order: 20, isVisible: hasAnyRole },
    },
    {
      id: 'my-team',
      paths: ['#/my-team'],
      page: myTeamPage,
      // The route is guarded as well as the link. It was not before, so a
      // non-manager with the URL could open a page the bar never offered them
      // — a nav item narrower than its route. That is a UX inconsistency
      // rather than a hole: what actually protects allocation is the
      // SharePoint list ACLs, and hiding a link makes nothing safe.
      guard: (caps) => caps.isReviewerManager,
      nav: { label: 'My Team', order: 60 },
    },
    {
      id: 'search',
      paths: ['#/search'],
      page: caseSearchPage,
      // Cross-Case-Type lookup is a capability, not a page: the mapping from
      // groups to it lives in one place, so widening it never touches a route.
      guard: (caps) => caps.canSearchCases,
      nav: { label: 'Search', order: 70 },
      // Controls read across Case Types rather than working a queue of their
      // own, so the cross-Case-Type lookup is where their day starts. Ranked
      // last of the three: someone who is Controls *and* a Reviewer or an
      // Adviser has a queue, and that is the more specific answer.
      defaultFor: (caps) => caps.isControls,
      defaultForOrder: 30,
    },
  ],
};

/**
 * The Section id union, projected from what this application composes —
 * built-in and application-added alike, with no distinction between them.
 *
 * This is what keeps `CaseTypeConfig.sections` a `Partial<Record<Section, …>>`
 * rather than a `Record<string, …>`, so a mistyped Section key stays a `tsc`
 * error rather than becoming a runtime one.
 *
 * @typedef {(typeof APP_CONFIG)['sectionPlugins'][number]['id']} Section
 */
