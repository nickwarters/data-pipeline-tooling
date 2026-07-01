// @ts-check
// TODO(simplify-ui): Rework routing around route functions that compose
// plain function components returning h() nodes. Keep custom elements only for
// route/browser-integration shells, not as the unit every route has to create.

/**
 * @typedef {{ mount: (el: Element, params: Record<string, string>) => void, unmount: () => void }} RouteHandler
 */

export class Router {
  constructor() {
    /** @type {Array<{ re: RegExp, keys: string[], handler: RouteHandler }>} */
    this._routes = [];

    /** @type {{ handler: RouteHandler, params: Record<string, string> } | null} */
    this._current = null;

    /** @type {Element | null} */
    this._container = null;
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

  /** @param {string} hash */
  navigate(hash) {
    const matched = this._match(hash);
    if (!matched) return;

    if (this._current) this._current.handler.unmount();
    this._current = matched;
    matched.handler.mount(
      /** @type {Element} */ (this._container),
      matched.params
    );
  }

  /** @param {Element} container */
  init(container) {
    this._container = container;
    window.addEventListener('hashchange', () => this.navigate(location.hash));
    this.navigate(location.hash || '#/');
  }
}
