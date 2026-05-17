// @ts-check

/**
 * @param {import('../router.js').Router} router
 * @param {import('../register-routes.js').AppContext} _context
 */
export function register(router, _context) {
  router.register('#/', {
    mount() { location.hash = '#/dashboard'; },
    unmount() {},
  });
}
