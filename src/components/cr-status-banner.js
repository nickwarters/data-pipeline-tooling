// @ts-check
import { CRElement } from './cr-element.js';

/** @typedef {import('../services/save-queue.js').SaveQueue} SaveQueue */
/** @typedef {import('../services/save-queue.js').SaveStatus} SaveStatus */

/**
 * Surfaces the SaveQueue status as user-visible UI:
 *   saved        → no banner
 *   saving       → polite "Saving…" indicator
 *   reconnecting → gentle "Reconnecting…" indicator (auto-clears on saved)
 *   conflict     → persistent assertive banner with a Reload button
 */
export class CRStatusBanner extends CRElement {
  constructor() {
    super();
    /** @type {SaveQueue | null} */
    this.saveQueue = null;
  }

  connectedCallback() {
    if (!this.saveQueue) return;
    this.subscribe(this.saveQueue.status, status => this._render(status));
  }

  /** @param {SaveStatus} status */
  _render(status) {
    if (status === 'saved') {
      this.replaceChildren();
      return;
    }
    if (status === 'conflict') {
      this.replaceChildren(this._renderConflict());
      return;
    }
    this.replaceChildren(this._renderTransient(status));
  }

  /**
   * @param {'saving' | 'reconnecting'} status
   * @returns {HTMLElement}
   */
  _renderTransient(status) {
    const div = document.createElement('div');
    div.className = `cr-banner cr-banner-${status}`;
    div.setAttribute('role', 'status');
    div.setAttribute('aria-live', 'polite');
    div.textContent = status === 'saving' ? 'Saving…' : 'Reconnecting…';
    return div;
  }

  /** @returns {HTMLElement} */
  _renderConflict() {
    const banner = document.createElement('div');
    banner.className = 'cr-banner cr-banner-conflict';
    banner.setAttribute('role', 'alert');
    banner.setAttribute('aria-live', 'assertive');

    const text = document.createElement('p');
    text.className = 'cr-banner-text';
    text.textContent = 'This Case was edited in another tab. Reload to continue.';

    const btn = document.createElement('button');
    btn.className = 'cr-banner-reload';
    btn.textContent = 'Reload';
    btn.addEventListener('click', () => location.reload());

    banner.appendChild(text);
    banner.appendChild(btn);
    return banner;
  }
}

customElements.define('cr-status-banner', CRStatusBanner);
