// @ts-check
import { h } from '../../lib/html.js';
import { formatTimeOfDay } from '../../lib/format-datetime.js';

/** @typedef {import('../../services/save-queue.js').SaveStatus} SaveStatus */

/**
 * Surfaces the SaveQueue status as user-visible UI:
 * saved -> a quiet "Last saved 15:32" once anything has saved, otherwise nothing
 * saving -> polite "Saving…" indicator
 * reconnecting -> gentle "Reconnecting…" indicator (auto-clears on saved)
 * conflict -> persistent assertive banner with a Reload button
 *
 * @param {{ status: SaveStatus, lastSavedAt?: string | null }} props
 * @returns {HTMLElement | HTMLElement[]}
 */
export function StatusBanner({ status, lastSavedAt = null }) {
  if (status === 'saved') {
    return lastSavedAt ? renderSaved(lastSavedAt) : [];
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

/**
 * Not a live region: the "Saving…" it replaces already told a screen reader a
 * save was happening, and announcing the clock after every keystroke's save
 * would talk over the person typing.
 *
 * @param {string} lastSavedAt
 * @returns {HTMLElement}
 */
function renderSaved(lastSavedAt) {
  return h(
    'div',
    { className: 'cora-banner cora-banner-saved' },
    `Last saved ${formatTimeOfDay(lastSavedAt)}`
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
