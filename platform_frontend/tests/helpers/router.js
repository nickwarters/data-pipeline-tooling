// @ts-check

/**
 * Initialise a real Router through its public API before registering routes.
 * With no routes registered yet, the current hash cannot trigger a mount.
 *
 * @param {{ init: (container: any) => void }} router
 * @param {any} container
 */
export function initRouter(router, container) {
  router.init(container);
}

/**
 * Capture route registration through the Router's public collaborator seam.
 * Route modules only need `register()`, so their pattern and handler contracts
 * can be tested without reading a real Router's private registry.
 */
export function routeRegistrationSpy() {
  /** @type {Map<string, { mount: Function, unmount: Function }>} */
  const handlers = new Map();
  return {
    router: {
      register(
        /** @type {string} */ pattern,
        /** @type {{ mount: Function, unmount: Function }} */ handler
      ) {
        handlers.set(pattern, handler);
      },
    },
    has: (/** @type {string} */ pattern) => handlers.has(pattern),
    handlerFor(/** @type {string} */ pattern) {
      const handler = handlers.get(pattern);
      if (!handler) throw new Error(`Route "${pattern}" was not registered`);
      return handler;
    },
  };
}
