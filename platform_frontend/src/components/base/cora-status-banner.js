// @ts-check
import { h } from '../../lib/html.js';

/** @typedef {import('../../services/save-queue.js').SaveStatus} SaveStatus */

/**
 * Surfaces the SaveQueue status as user-visible UI:
 * saved -> no banner
 * saving -> polite "Saving…" indicator
 * reconnecting -> polite notice that SharePoint can't be reached and the work
 *   is being kept; once the outage is long it also says to check the
 *   connection or VPN (auto-clears on saved)
 * failed -> persistent assertive banner listing why each write was given up
 *   on, with a Reload button when a message says the Case is gone
 * conflict -> persistent assertive banner with a Reload button
 *
 * The view takes strings and flags, never the failures themselves: the page
 * words them, so this stays a leaf that imports no service.
 *
 * @param {{
 *   status: SaveStatus,
 *   longOutage?: boolean,
 *   messages?: string[],
 *   offerReload?: boolean,
 * }} props
 * @returns {HTMLElement | HTMLElement[]}
 */
export function StatusBanner({
  status,
  longOutage = false,
  messages = [],
  offerReload = false,
}) {
  if (status === 'saved') {
    return [];
  }
  if (status === 'conflict') {
    return renderConflict();
  }
  if (status === 'failed') {
    return renderFailed(messages, offerReload);
  }
  if (status === 'reconnecting') {
    return renderReconnecting(longOutage);
  }
  return renderTransient('saving', 'Saving…');
}

/**
 * @param {'saving' | 'reconnecting'} status
 * @param {string} text
 * @returns {HTMLElement}
 */
function renderTransient(status, text) {
  return h(
    'div',
    {
      className: `cora-banner cora-banner-${status}`,
      role: 'status',
      'aria-live': 'polite',
    },
    text
  );
}

/**
 * @param {boolean} longOutage
 * @returns {HTMLElement}
 */
function renderReconnecting(longOutage) {
  const kept =
    "Can't reach SharePoint. Retrying… Your changes are kept while this tab stays open.";
  return renderTransient(
    'reconnecting',
    longOutage ? `${kept} Check your connection or VPN.` : kept
  );
}

/**
 * @param {string[]} messages
 * @param {boolean} offerReload
 * @returns {HTMLElement}
 */
function renderFailed(messages, offerReload) {
  const distinct = [...new Set(messages)];
  return h(
    'div',
    {
      className: 'cora-banner cora-banner-failed',
      role: 'alert',
      'aria-live': 'assertive',
    },
    [
      distinct.length === 1
        ? h('p', { className: 'cora-banner-text' }, distinct[0])
        : h(
            'ul',
            { className: 'cora-banner-text cora-banner-failures' },
            distinct.map((message) => h('li', {}, message))
          ),
      ...(offerReload ? [reloadButton()] : []),
    ]
  );
}

/** @returns {HTMLElement} */
function renderConflict() {
  return h(
    'div',
    {
      className: 'cora-banner cora-banner-conflict',
      role: 'alert',
      'aria-live': 'assertive',
    },
    [
      h(
        'p',
        { className: 'cora-banner-text' },
        'This Case was edited in another tab. Reload to continue.'
      ),
      reloadButton(),
    ]
  );
}

/** @returns {HTMLElement} */
function reloadButton() {
  return h(
    'button',
    {
      className: 'cora-banner-reload',
      onclick: () => location.reload(),
    },
    'Reload'
  );
}
