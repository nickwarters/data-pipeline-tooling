// @ts-check
import { ReactiveElement } from './reactive-element.js';
import { h } from '../lib/html.js';

/** @typedef {import('../services/save-queue.js').SaveQueue} SaveQueue */
/** @typedef {import('../services/save-queue.js').SaveStatus} SaveStatus */

/**
 * Surfaces the SaveQueue status as user-visible UI:
 *   saved        → no banner
 *   saving       → polite "Saving…" indicator
 *   reconnecting → gentle "Reconnecting…" indicator (auto-clears on saved)
 *   conflict     → persistent assertive banner with a Reload button
 */
export class CRStatusBanner extends ReactiveElement {
  constructor() {
    super();
    /** @type {SaveQueue | null} */
    this.saveQueue = null;
  }

  connectedCallback() {
    Object.assign(this.style, {
      position: 'fixed',
      bottom: 'var(--cr-space-4)',
      right: 'var(--cr-space-4)',
      zIndex: '110',
    });
    super.connectedCallback();
  }

  /**
   * Preserved for test compatibility.
   * @param {SaveStatus} [status]
   */
  _render(status) {
    const content = this.render();
    if (content && typeof content === 'object' && 'appendChild' in content) {
      this.replaceChildren(content);
    } else if (Array.isArray(content)) {
      this.replaceChildren(...content);
    } else {
      this.replaceChildren();
    }
  }

  render() {
    if (!this.saveQueue) return [];
    const status = this.saveQueue.status.get();

    if (status === 'saved') {
      return [];
    }
    if (status === 'conflict') {
      return this._renderConflict();
    }
    return this._renderTransient(status);
  }

  /**
   * @param {'saving' | 'reconnecting'} status
   * @returns {HTMLElement}
   */
  _renderTransient(status) {
    return h(
      'div',
      {
        className: `cr-banner cr-banner-${status}`,
        role: 'status',
        'aria-live': 'polite',
      },
      status === 'saving' ? 'Saving…' : 'Reconnecting…'
    );
  }

  /** @returns {HTMLElement} */
  _renderConflict() {
    return h(
      'div',
      {
        className: 'cr-banner cr-banner-conflict',
        role: 'alert',
        'aria-live': 'assertive',
      },
      [
        h(
          'p',
          { className: 'cr-banner-text' },
          'This Case was edited in another tab. Reload to continue.'
        ),
        h(
          'button',
          {
            className: 'cr-banner-reload',
            onClick: () => location.reload(),
          },
          'Reload'
        ),
      ]
    );
  }
}

customElements.define('cr-status-banner', CRStatusBanner);
