// @ts-check
import { h, svg } from '../lib/html.js';

/**
 * The small at-a-glance marks a Case row carries beside its **Reference**: a
 * clock when the Case is **On Hold**, a speech bubble when its **Conversation**
 * holds any **Messages**.
 *
 * Both are read straight off `CaseRow` — `onHold` is the stored flag the Action
 * Centre's On Hold group filters on, and `conversation` is the JSON blob every
 * Case read already carries — so a flag costs no extra query and means the same
 * thing on every table it appears in.
 *
 * The marks live here rather than in `case-columns.js` because the Action Centre
 * is not a Case table: it renders its own rows and shows the message mark on
 * them, so the icon and its accessible name have to be sayable in one place both
 * can reach.
 *
 * They are drawn rather than typed. An emoji is a font decision — it renders as
 * a different glyph, in a different colour, at a different weight on every box
 * the app is opened on, and SharePoint's page chrome is not ours to control —
 * whereas an inline `svg()` inherits `currentColor` and the surrounding size.
 */

/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */

/**
 * @typedef {Object} CaseFlagDescriptor
 * @property {string} id Stable identity: the CSS modifier, and how a caller names one mark.
 * @property {(row: CaseRow) => boolean} raisedBy Whether this Case carries the flag.
 * @property {(row: CaseRow) => string} label The mark's accessible name and pointer tooltip.
 * @property {() => any[]} marks The shapes drawn inside the shared 16-unit frame.
 */

/**
 * Every icon is drawn on the same 16-unit grid at the same stroke weight, so the
 * two read as one set rather than as two borrowed glyphs.
 */
const ICON_SIZE = 14;
const VIEW_BOX = '0 0 16 16';

/** The one place a Case's flags — and the order they are shown in — are stated.
 *
 * Order is part of the contract: it is what makes a column of marks scannable
 * down a table, so it is declared once here and every consumer derives from it.
 * Adding a third flag is one entry, and it lands in the Case tables' column and
 * in anything naming it directly without either being edited.
 *
 * @type {CaseFlagDescriptor[]}
 */
const CASE_FLAGS = [
  {
    id: 'hold',
    raisedBy: (row) => row.onHold === true,
    label: () => 'On hold',
    marks: () => [
      svg('circle', { cx: '8', cy: '8', r: '6.25' }),
      svg('path', { d: 'M8 4.5V8l2.5 1.75' }),
    ],
  },
  {
    id: 'messages',
    raisedBy: (row) => messageCount(row) > 0,
    // The count is in the name rather than printed beside the mark: a reader
    // who wants it hovers or hears it, and the cell stays one glyph wide.
    label: (row) => {
      const count = messageCount(row);
      return `${count} message${count === 1 ? '' : 's'}`;
    },
    marks: () => [
      svg('path', {
        d: 'M3.5 2.75h9a1.75 1.75 0 0 1 1.75 1.75v5a1.75 1.75 0 0 1-1.75 1.75H7.25L4 13.75V11.25H3.5A1.75 1.75 0 0 1 1.75 9.5v-5A1.75 1.75 0 0 1 3.5 2.75Z',
      }),
    ],
  },
];

/**
 * How many **Messages** the Case's **Conversation** holds. A row read through a
 * list query carries the parsed blob, and a fixture may leave it off entirely,
 * so a missing Conversation counts as none rather than throwing.
 *
 * @param {CaseRow} row
 * @returns {number}
 */
function messageCount(row) {
  return Array.isArray(row.conversation) ? row.conversation.length : 0;
}

/**
 * @param {CaseFlagDescriptor} flag
 * @param {CaseRow} row
 * @returns {SVGElement}
 */
function flagIcon(flag, row) {
  const label = flag.label(row);
  return svg(
    'svg',
    {
      className: `cora-case-flag cora-case-flag--${flag.id}`,
      viewBox: VIEW_BOX,
      width: String(ICON_SIZE),
      height: String(ICON_SIZE),
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '1.5',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      role: 'img',
      // A decorative-looking mark that is not decorative: it carries the only
      // statement of the fact on the row, so it is named for a screen reader
      // (`aria-label`) and titled for a pointer (`<title>`). `aria-label` wins
      // the name computation, so the two do not announce twice.
      'aria-label': label,
      focusable: 'false',
    },
    svg('title', {}, label),
    ...flag.marks()
  );
}

/**
 * The flags a Case row raises, in the declared order.
 *
 * @param {CaseRow} row
 * @returns {{ id: string, label: string }[]}
 */
export function caseFlags(row) {
  return CASE_FLAGS.filter((flag) => flag.raisedBy(row)).map((flag) => ({
    id: flag.id,
    label: flag.label(row),
  }));
}

/**
 * One named mark, for a consumer that wants a specific flag rather than all of
 * them — the Action Centre shows the bubble alone, because its groups already
 * say which Cases are held. `null` when this Case does not raise it.
 *
 * An unknown id throws rather than rendering nothing, so a typo fails at the
 * call site that made it instead of quietly costing a mark nobody notices is
 * missing.
 *
 * @param {CaseRow} row
 * @param {string} id
 * @returns {SVGElement | null}
 */
export function caseFlagIcon(row, id) {
  const flag = CASE_FLAGS.find((candidate) => candidate.id === id);
  if (!flag) throw new Error(`unknown Case flag: ${id}`);
  return flag.raisedBy(row) ? flagIcon(flag, row) : null;
}

/**
 * Every mark this Case raises, or `null` when it raises none — an empty cell,
 * not a dash, because a dash reads as a value the Case has.
 *
 * @param {CaseRow} row
 * @returns {HTMLElement | null}
 */
export function caseFlagIcons(row) {
  const icons = CASE_FLAGS.filter((flag) => flag.raisedBy(row)).map((flag) =>
    flagIcon(flag, row)
  );
  if (icons.length === 0) return null;
  return h('span', { className: 'cora-case-flags' }, ...icons);
}
