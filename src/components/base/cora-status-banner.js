// @ts-check
import { h } from '../../lib/html.js';

/** @typedef {import('../../services/save-queue.js').SaveStatus} SaveStatus */

/**
 * Surfaces the SaveQueue status as user-visible UI:
 * saved -> no banner
 * saving -> polite "Saving…" indicator
 * reconnecting -> gentle "Reconnecting…" indicator (auto-clears on saved)
 * conflict -> persistent assertive banner with a Reload button
 *
 * @param {{ status: SaveStatus }} props
 * @returns {HTMLElement | HTMLElement[]}
 */
export function StatusBanner({ status }) {
  if (status === 'saved') {
    return [];
  }
  if (status === 'conflict') {
    return renderConflict();
  }
  return renderTransient(status);
}

/**
 * @param {'saving' | 'reconnecting'} status
 * @returns {HTMLElement}
 */
function renderTransient(status) {
  return h(
    'div',
    {
      className: `cora-banner cora-banner-${status}`,
      role: 'status',
      'aria-live': 'polite',
    },
    status === 'saving' ? 'Saving…' : 'Reconnecting…'
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
      h(
        'button',
        {
          className: 'cora-banner-reload',
          onclick: () => location.reload(),
        },
        'Reload'
      ),
    ]
  );
}
