// @ts-check
import { h } from '../../lib/html.js';
import { buildSummaryModel } from '../../evaluators/summary-model.js';

/**
 * What a counted Question Group is filed under when its Questions declare no
 * **Category** but others in the same Case Type do. The Review tab's fallback
 * for the same position, so the two tabs name it identically.
 */
const UNCATEGORISED = 'General';

/**
 * The **Questions** Summary block: pass/fail counts per Question Group.
 *
 * @param {import('./summary-view.js').SummaryBlockProps} props
 * @returns {HTMLElement}
 */
export function questionsSummaryView(props) {
  const { groupCounts } = buildSummaryModel(props.catalogue, props.answers);
  return h(
    'section',
    { className: 'cora-summary-counts' },
    h('h3', {}, props.heading),
    ...countChildren(groupCounts)
  );
}

/**
 * The Questions block's body: one `<li>` per Question Group, either flat or
 * nested under its **Category** heading.
 *
 * The Category level is rendered only when some counted Question declares one —
 * the same rule the Review tab applies, so a Case Type that never names a
 * Category sees exactly the flat list it saw before, and one that does sees the
 * Summary grouped the way its Reviewers read the questions.
 *
 * @param {import('../../evaluators/summary-model.js').GroupCount[]} groupCounts
 * @returns {Node[]}
 */
function countChildren(groupCounts) {
  const countLine = (
    /** @type {import('../../evaluators/summary-model.js').GroupCount} */ c
  ) => h('li', {}, `${c.group}: ${c.pass} pass, ${c.fail} fail`);

  if (!groupCounts.some((count) => count.category))
    return [h('ul', {}, ...groupCounts.map(countLine))];

  /** @type {Map<string, import('../../evaluators/summary-model.js').GroupCount[]>} */
  const byCategory = new Map();
  for (const count of groupCounts) {
    const name = count.category || UNCATEGORISED;
    const rows = byCategory.get(name);
    if (rows) rows.push(count);
    else byCategory.set(name, [count]);
  }
  return [...byCategory].flatMap(([name, rows]) => [
    h('h4', { className: 'cora-summary-category-heading' }, name),
    h('ul', {}, ...rows.map(countLine)),
  ]);
}
