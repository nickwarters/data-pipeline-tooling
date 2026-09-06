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
 * The order of `sectionPlugins` carries no meaning. The two orders that do are
 * each plugin's own `tabOrder` and `summaryOrder`, which the tab strip and the
 * Summary sort by; both accept fractional values, so a Section slots between
 * two others without renumbering them.
 *
 * `const`-asserted so each plugin's literal `id` survives inference — that is
 * what lets `Section` below be projected from the composition rather than
 * restated in a second table. Do not annotate this object or the array with a
 * widening `@type`: `readonly SectionPlugin[]` turns every `id` into `string`
 * and the union silently becomes `string`, which type-checks everywhere and
 * checks nothing. Each plugin's conformance to the contract is asserted by its
 * own `@satisfies`, so the shape is not unguarded.
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

export const APP_CONFIG = /** @type {const} */ ({
  sectionPlugins: [
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
  ],
});

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
