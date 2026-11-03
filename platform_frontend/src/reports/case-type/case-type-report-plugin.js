// @ts-check
import { RANGES, buildCaseTypeReport } from './case-type-report-model.js';
import { caseTypeReportContent } from './case-type-report-view.js';

/**
 * The Case Type report: backlog, timeliness and flow for one Case Type.
 *
 * Its audience is that Case Type's Owners, plus Maintainers, who own every
 * Case Type's groups. The file for each Case Type sits in its own folder, and
 * that folder is readable by exactly the groups these rules name.
 *
 * @satisfies {import('../contract.js').ReportPlugin}
 */
export const CaseTypeReport = {
  id: 'case-type',
  title: 'Case Type report',
  description: 'Backlog, timeliness and flow for a Case Type you own.',
  layout: /** @type {const} */ ('stacked'),
  access: /** @type {const} */ ([
    'maintainer',
    { role: 'caseTypeOwner', of: 'scope' },
  ]),
  scope: /** @type {const} */ ({ kind: 'case-type' }),
  feeds: {
    report: {
      path: (/** @type {import('../contract.js').ReportScope} */ scope) =>
        `case-types/${scope.key}/case-type.txt`,
      schemaVersion: 1,
    },
  },
  filters: {
    range: {
      label: 'Range',
      options: Object.entries(RANGES).map(([key, { label }]) => ({
        key,
        label,
      })),
      initial: '6m',
    },
  },
  view: (
    /** @type {Parameters<import('../contract.js').ReportPlugin['view']>[0]} */ {
      feeds,
      filters,
    }
  ) => caseTypeReportContent(buildCaseTypeReport(feeds.report, filters.range)),
};
