// @ts-check
import { h } from '../../lib/html.js';
import { defineView } from '../../lib/view.js';

/** @typedef {import('../../services/save-queue.js').SaveQueue} SaveQueue */
/** @typedef {import('../../services/save-queue.js').SaveStatus} SaveStatus */

/**
 * Surfaces the SaveQueue status as user-visible UI:
 *   saved        -> no banner
 *   saving       -> polite "Saving…" indicator
 *   reconnecting -> gentle "Reconnecting…" indicator (auto-clears on saved)
 *   conflict     -> persistent assertive banner with a Reload button
 *
 * @param {{ saveQueue: SaveQueue | null }} props
 * @returns {HTMLElement | HTMLElement[]}
 */
export function StatusBanner({ saveQueue }) {
  if (!saveQueue) return [];
  const status = saveQueue.status.get();

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
          onClick: () => location.reload(),
        },
        'Reload'
      ),
    ]
  );
}

export const CORAStatusBanner = defineView('cora-status-banner', {
  props: /** @type {{ saveQueue: SaveQueue | null }} */ ({
    saveQueue: null,
  }),
  render({ props }) {
    return StatusBanner({ saveQueue: props.saveQueue });
  },
  afterMount({ host }) {
    Object.assign(host.style, {
      position: 'fixed',
      bottom: 'var(--cora-space-4)',
      right: 'var(--cora-space-4)',
      zIndex: '110',
    });
  },
});
