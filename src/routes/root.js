// @ts-check

/**
 * @param {import('../lib/router.js').Router} router
 * @param {import('../setup/register-routes.js').AppContext} context
 */
export function register(router, context) {
  router.register('#/', {
    mount() {
      const el = /** @type {import('../pages/cr-home.js').CRHome} */ (
        document.createElement('cr-home')
      );
      el.capabilities = context.capabilities;
      context.appEl.appendChild(el);
    },
    unmount() {
      context.appEl.replaceChildren();
    },
  });
}
