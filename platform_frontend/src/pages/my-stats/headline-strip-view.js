// @ts-check
import { h } from '../../lib/html.js';
import { SHORT_MONTH_NAMES } from '../../evaluators/stats-range-model.js';

/** @typedef {import('../../evaluators/stats-report-model.js').StatsHeadline} StatsHeadline */

/**
 * This is not the dashboard's KPI strip, and it deliberately does not reuse it.
 * That strip is a role worklist: lanes the viewer holds, expandable tiles with
 * a tone and a breakdown axis, and two toggle callbacks over store-held sets of
 * what is open. It answers "what should I work on next", and every one of those
 * parts is load-bearing there. This answers "how much did I get through", is
 * four static figures with no lanes, no roles, nothing to expand and nothing to
 * click, and two of its four values are not whole numbers at all — an average
 * to one decimal place, and a date paired with a count. Fitting them into a
 * tile would mean widening that component's model to carry a text value and a
 * second line, and handing it callbacks that do nothing. The two are the same
 * shape only at a glance.
 *
 * @param {{ label: string, value: string, detail?: string | null }} figure
 * @returns {HTMLElement}
 */
function figureView({ label, value, detail = null }) {
  return h(
    'div',
    { className: 'cora-my-stats-figure' },
    h('span', { className: 'cora-my-stats-figure__value' }, value),
    h('span', { className: 'cora-my-stats-figure__label' }, label),
    detail === null
      ? null
      : h('span', { className: 'cora-my-stats-figure__detail' }, detail)
  );
}

/**
 * A day-and-month rendering of a calendar date key, for a figure that has room
 * for neither the year nor the weekday.
 *
 * @param {string} dateKey `YYYY-MM-DD`
 * @returns {string}
 */
function shortDate(dateKey) {
  const [, month, day] = dateKey.split('-').map(Number);
  return `${day} ${SHORT_MONTH_NAMES[month - 1]}`;
}

/**
 * The headline figures for the selected range.
 *
 * The average is labelled "avg per working day" in full and never shortened to
 * "avg/day": the two differ by roughly a third, and the short label invites a
 * Reviewer to compare their figure against a number that was never measured the
 * same way. The asterisk on the total carries the one rule that is not visible
 * in the numbers themselves.
 *
 * @param {StatsHeadline} headline
 * @returns {HTMLElement}
 */
export function headlineStripView(headline) {
  const { total, workingDays, averagePerWorkingDay, activeDays, busiestDay } =
    headline;
  return h(
    'section',
    {
      className: 'cora-my-stats-headline',
      'aria-labelledby': 'cora-my-stats-headline-heading',
    },
    h(
      'h2',
      {
        id: 'cora-my-stats-headline-heading',
        className: 'cora-my-stats-headline__heading',
      },
      'Headline figures'
    ),
    h(
      'div',
      { className: 'cora-my-stats-headline__figures' },
      figureView({ label: 'Total *', value: String(total) }),
      figureView({
        label: 'Avg per working day',
        value:
          averagePerWorkingDay === null ? '—' : averagePerWorkingDay.toFixed(1),
        detail: `${workingDays} working ${workingDays === 1 ? 'day' : 'days'}`,
      }),
      figureView({ label: 'Active days', value: String(activeDays) }),
      figureView({
        label: 'Busiest day',
        value: busiestDay === null ? '—' : shortDate(busiestDay.date),
        detail:
          busiestDay === null
            ? null
            : `${busiestDay.count} ${busiestDay.count === 1 ? 'Case' : 'Cases'}`,
      })
    ),
    h('p', { className: 'cora-my-stats-headline__note' }, '* excludes today')
  );
}
