// @ts-check
import { HomePage } from '../pages/cora-home.js';

/**
 * @param {import('../lib/router.js').Router} router
 * @param {import('../setup/register-routes.js').AppContext} context
 */
export function register(router, context) {
  router.register('#/', {
    mount() {
      context.appEl.replaceChildren(
        ...HomePage({ capabilities: context.capabilities })
      );
    },
    unmount() {
      context.appEl.replaceChildren();
    },
  });
}
