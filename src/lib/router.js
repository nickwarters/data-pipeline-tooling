// @ts-check
// A route handler is a plain `{ mount, unmount }` pair. `mount` composes
// function components and calls `container.replaceChildren(...)`; the router
// never owns a custom element per route.

/**
 * @typedef {{ mount: (el: Element, params: Record<string, string>) => void | Promise<void>, unmount: () => void }} RouteHandler
 */

export class Router {
  constructor() {
    /** @type {Array<{ re: RegExp, keys: string[], handler: RouteHandler }>} */
    this._routes = [];

    /** @type {{ handler: RouteHandler, params: Record<string, string> } | null} */
    this._current = null;

    /** @type {Element | null} */
    this._container = null;

    /** @type {number} */
    this._navSeq = 0;
  }

  /**
   * @param {string} pattern - Hash pattern, e.g. '#/dashboard' or '#/case/:id'
   * @param {RouteHandler} handler
   */
  register(pattern, handler) {
    /** @type {string[]} */
    const keys = [];
    const reStr = pattern.replace(/:([^/]+)/g, (_, key) => {
      keys.push(key);
      return '([^/]+)';
    });
    this._routes.push({ re: new RegExp(`^${reStr}$`), keys, handler });
  }

  /**
   * @param {string} hash
   * @returns {{ handler: RouteHandler, params: Record<string, string> } | null}
   */
  _match(hash) {
    const path = hash.split('?')[0];
    for (const route of this._routes) {
      const m = path.match(route.re);
      if (m) {
        /** @type {Record<string, string>} */
        const params = {};
        route.keys.forEach((key, i) => {
          params[key] = decodeURIComponent(m[i + 1]);
        });
        return { handler: route.handler, params };
      }
    }
    return null;
  }

  /**
   * @param {string} hash
   * @returns {Promise<void>}
   */
  async navigate(hash) {
    const matched = this._match(hash);
    if (!matched) return;

    this._navSeq += 1;
    const token = this._navSeq;

    if (this._current) this._current.handler.unmount();
    this._current = matched;
    try {
      await matched.handler.mount(
        /** @type {Element} */ (this._container),
        matched.params
      );
    } catch (err) {
      if (token !== this._navSeq) return;
      console.error(`[CORA] route mount failed for "${hash}"`, err);
      const panel = document.createElement('div');
      panel.className = 'cora-route-error';
      const heading = document.createElement('p');
      heading.textContent = 'This page failed to load';
      const body = document.createElement('p');
      body.textContent =
        'Use the navigation to go somewhere else, or reload to retry.';
      panel.appendChild(heading);
      panel.appendChild(body);
      /** @type {Element} */ (this._container).replaceChildren(panel);
    }
  }

  /** @param {Element} container */
  init(container) {
    this._container = container;
    window.addEventListener('hashchange', () => {
      void this.navigate(location.hash);
    });
    void this.navigate(location.hash || '#/');
  }
}
