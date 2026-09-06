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

import { redirectTo } from './lib/navigate.js';

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

/**
 * Bounce a user this route is not for, and say the mount must not happen.
 *
 * Replaces the history entry rather than pushing one, so Back does not return
 * the user to the route that just bounced them.
 *
 * @returns {false}
 */
function bounceHome() {
  redirectTo('#/');
  return false;
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
   * anything. A route's eligibility is its own `guard`, a function of the boot
   * context rather than a closure over it, so this stays a list of facts.
   *
   * @type {readonly PagePlugin[]}
   */
  pagePlugins: [
    { id: 'root', paths: ['#/'], page: homePage },
    { id: 'dashboard', paths: ['#/dashboard'], page: dashboardPage },
    {
      id: 'my-stats',
      paths: ['#/my-stats'],
      page: myStatsPage,
      guard: (context) => context.chrome.permissions.isReviewer || bounceHome(),
    },
    {
      id: 'team-stats',
      paths: ['#/team-stats'],
      page: teamStatsPage,
      guard: (context) =>
        context.chrome.permissions.isReviewerManager || bounceHome(),
    },
    {
      id: 'question-bank',
      paths: ['#/question-bank'],
      load: () => import('./pages/question-bank/cora-bank-editor.js'),
      loadOverride: (context) => context.loadQuestionBankEditor,
    },
    {
      id: 'case',
      paths: ['#/case/:caseType/:id', '#/case/:id'],
      page: caseReviewPage,
    },
    { id: 'team-cases', paths: ['#/team-cases'], page: teamCasesPage },
    { id: 'my-cases', paths: ['#/my-cases'], page: responsiblePartyPage },
    {
      id: 'journey-cases',
      paths: ['#/journey-cases'],
      page: journeyCasesPage,
      // List-scope Journey Owner capability: only a user who owns at least one
      // Case Type as a Journey Owner may see this view.
      guard: (context) => context.journeyCaseSources.length > 0 || bounceHome(),
    },
    { id: 'roadmap', paths: ['#/roadmap'], page: roadmapPage },
    { id: 'my-team', paths: ['#/my-team'], page: myTeamPage },
    {
      id: 'search',
      paths: ['#/search'],
      page: caseSearchPage,
      // Cross-Case-Type lookup is a capability, not a page: the mapping from
      // groups to it lives in one place, so widening it never touches a route.
      guard: (context) =>
        context.chrome.permissions.canSearchCases || bounceHome(),
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
