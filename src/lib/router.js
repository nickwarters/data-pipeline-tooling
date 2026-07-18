// @ts-check
// A route handler is a plain `{ mount, unmount }` pair. `mount` composes
// function components and calls `container.replaceChildren(...)`; the router
// never owns a custom element per route.
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
      await matched.handler.mount(
        this._guardContainer(container, token),
        matched.params
      );
    } catch (err) {
      if (token !== this._navSeq) return;
      console.error(`[CORA] route mount failed for "${hash}"`, err);
      container.replaceChildren(createRouteErrorPanel());
    }
  }

  /**
   * Wrap the route container so a stale mount cannot write to it. Because mount
   * is async and a page module may resolve after the user has navigated on, the
   * route's own `container.replaceChildren(...)` (which runs after its `await`)
   * could otherwise overwrite the newer page. The returned proxy forwards every
   * container method only while this navigation is still current; once a newer
   * `navigate()` has bumped `_navSeq`, the call becomes a no-op. Routes that
   * render outside the container (root writes to `context.appEl`) are the
   * documented exception — see the page-independence plan §4.1.
   *
   * @param {Element} container
   * @param {number} token
   * @returns {Element}
   */
  _guardContainer(container, token) {
    return new Proxy(container, {
      get: (obj, prop) => {
        const value = Reflect.get(obj, prop);
        if (typeof value !== 'function') return value;
        return (/** @type {any[]} */ ...args) => {
          if (token !== this._navSeq) return undefined;
          return value.apply(obj, args);
        };
      },
    });
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
