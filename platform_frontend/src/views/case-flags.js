// @ts-check
import { h, svg } from '../lib/html.js';

/**
 * The small at-a-glance marks a Case row carries beside its reference: a clock
 * when the Case is **On Hold**, a speech bubble when its **Conversation** holds
 * any **Messages**.
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
 * Every icon is drawn on the same 16-unit grid at the same stroke weight, so the
 * two read as one set rather than as two borrowed glyphs.
 */
const ICON_SIZE = 14;
const VIEW_BOX = '0 0 16 16';

/**
 * @param {{ name: string, label: string }} options
 * @param {...any} marks
 * @returns {SVGElement}
 */
function flagIcon({ name, label }, ...marks) {
  return svg(
    'svg',
    {
      className: `cora-case-flag cora-case-flag--${name}`,
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
    ...marks
  );
}

/** @param {number} count */
function messageFlagLabel(count) {
  return `${count} message${count === 1 ? '' : 's'}`;
}

const ON_HOLD_FLAG_LABEL = 'On hold';

/** @returns {SVGElement} */
function onHoldFlagIcon() {
  return flagIcon(
    { name: 'hold', label: ON_HOLD_FLAG_LABEL },
    svg('circle', { cx: '8', cy: '8', r: '6.25' }),
    svg('path', { d: 'M8 4.5V8l2.5 1.75' })
  );
}

/** @param {number} count @returns {SVGElement} */
export function messageFlagIcon(count) {
  return flagIcon(
    { name: 'messages', label: messageFlagLabel(count) },
    svg('path', {
      d: 'M3.5 2.75h9a1.75 1.75 0 0 1 1.75 1.75v5a1.75 1.75 0 0 1-1.75 1.75H7.25L4 13.75V11.25H3.5A1.75 1.75 0 0 1 1.75 9.5v-5A1.75 1.75 0 0 1 3.5 2.75Z',
    })
  );
}

/**
 * How many **Messages** the Case's **Conversation** holds. A row read through a
 * list query carries the parsed blob, and a fixture may leave it off entirely,
 * so a missing Conversation counts as none rather than throwing.
 *
 * @param {CaseRow} row
 * @returns {number}
 */
export function messageCount(row) {
  return Array.isArray(row.conversation) ? row.conversation.length : 0;
}

/**
 * The flags a Case row raises, in a fixed order so a column of them reads down
 * the table. Ids are the CSS/test hooks and part of the contract.
 *
 * @param {CaseRow} row
 * @returns {{ id: string, label: string }[]}
 */
export function caseFlags(row) {
  /** @type {{ id: string, label: string }[]} */
  const flags = [];
  if (row.onHold === true)
    flags.push({ id: 'hold', label: ON_HOLD_FLAG_LABEL });
  const messages = messageCount(row);
  if (messages > 0)
    flags.push({ id: 'messages', label: messageFlagLabel(messages) });
  return flags;
}

/**
 * The flag marks for one Case, or `null` when it raises none — an empty cell,
 * not a dash, because a dash reads as a value the Case has.
 *
 * @param {CaseRow} row
 * @returns {HTMLElement | null}
 */
export function caseFlagIcons(row) {
  const messages = messageCount(row);
  const icons = [
    row.onHold === true ? onHoldFlagIcon() : null,
    messages > 0 ? messageFlagIcon(messages) : null,
  ].filter(Boolean);
  if (icons.length === 0) return null;
  return h('span', { className: 'cora-case-flags' }, ...icons);
}
