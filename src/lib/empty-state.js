// @ts-check
import { h } from './html.js';

/**
 * Standard empty-state element: a muted "nothing here yet" placeholder.
 *
 * Every site keeps its own class as a CSS hook (`className`), and all sites
 * additionally carry the shared `cora-empty` class so future styling has a
 * single seam. Most sites are paragraphs, but a few render a `span` (inline,
 * e.g. label rows) or a `div` (code-comment style placeholders in the bank
 * editor), so the tag is configurable and defaults to `'p'`.
 *
 * @param {string} message user-visible placeholder text
 * @param {{ className?: string, tag?: string }} [options]
 * @returns {HTMLElement}
 */
export function EmptyState(message, { className = '', tag = 'p' } = {}) {
  return h(tag, { className: `cora-empty ${className}`.trim() }, message);
}

/**
 * Standard in-flight placeholder: the sibling of `EmptyState` for the moment
 * before a route's first read resolves.
 *
 * Five pages each wrote their own, and they had drifted into two spellings of
 * the ellipsis (`Loading...` and `Loading…`) — so call sites pass the *subject*
 * only and the trailing character is decided here, once.
 *
 * @param {string} [subject] what is loading, e.g. `'Loading roadmap'`
 * @param {{ className?: string, tag?: string }} [options]
 * @returns {HTMLElement}
 */
export function LoadingState(
  subject = 'Loading',
  { className = '', tag = 'p' } = {}
) {
  return h(
    tag,
    { className: `cora-loading ${className}`.trim() },
    `${subject}…`
  );
}
