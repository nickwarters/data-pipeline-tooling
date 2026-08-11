// @ts-check
// A route handler is a plain `{ mount, unmount }` pair. `mount` resolves a
// page module and hands off to its adapter (see `core/store-route.js`), which
// commits the route's view through the keyed `render()` reconciler rather than
// replacing the container's children; the router never owns a custom element
// per route.
import { createRouteErrorPanel } from './route-error-panel.js';

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
   * Match a hash against the registered patterns. The router already has to
   * split the query string off in order to match the path, so it hands that
   * query string back to the handler as `params.queryString` rather than
   * making a route reach for `location.hash` itself. It is the raw
   * string, leading `?` included (or `''` when there is no query), because the
   * vocabulary of what a page's parameters mean belongs to that page — see
   * how `pages/cora-team-cases.js` reads its own `caseType` out of it.
   *
   * `queryString` is a reserved key: it is assigned after the `:param` loop, so
   * a pattern declaring `:queryString` has its path param overwritten. The
   * router's own contract wins deliberately — a page must be able to trust the
   * key is the query — but no route declares one today.
   *
   * @param {string} hash
   * @returns {{ handler: RouteHandler, params: Record<string, string> } | null}
   */
  _match(hash) {
    const queryIndex = hash.indexOf('?');
    const path = queryIndex === -1 ? hash : hash.slice(0, queryIndex);
    const queryString = queryIndex === -1 ? '' : hash.slice(queryIndex);
    for (const route of this._routes) {
      const m = path.match(route.re);
      if (m) {
        /** @type {Record<string, string>} */
        const params = {};
        route.keys.forEach((key, i) => {
          params[key] = decodeURIComponent(m[i + 1]);
        });
        params.queryString = queryString;
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

    if (this._current) {
      // A failing unmount must not block the next route from mounting; isolate
      // it the same way registration and mount failures are isolated.
      try {
        this._current.handler.unmount();
      } catch (err) {
        console.error('[CORA] route unmount failed', err);
      }
    }
    this._current = matched;

    const container = /** @type {Element} */ (this._container);
    try {
      await matched.handler.mount(container, matched.params);
    } catch (err) {
      if (token !== this._navSeq) return;
      console.error(`[CORA] route mount failed for "${hash}"`, err);
      container.replaceChildren(createRouteErrorPanel());
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
