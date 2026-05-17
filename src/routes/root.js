// @ts-check

/**
 * @param {import('../lib/router.js').Router} router
 * @param {import('../setup/register-routes.js').AppContext} _context
 */
export function register(router, _context) {
  router.register('#/', {
    mount() { location.hash = '#/dashboard'; },
    unmount() {},
  });
}
