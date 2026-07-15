// @ts-check
import { TeamCasesPage } from '../pages/cora-team-cases.js';

/**
 * @param {import('../lib/router.js').Router} router
 * @param {import('../setup/register-routes.js').AppContext} context
 */
export function register(router, context) {
  router.register('#/team-cases', {
    mount(container) {
      const queryString = location.hash.includes('?')
        ? location.hash.slice(location.hash.indexOf('?'))
        : '';
      container.replaceChildren(
        TeamCasesPage({
          client: context.client,
          currentUser: context.currentUser,
          caseSources: context.caseSources,
          queryString,
        })
      );
    },
    unmount() {},
  });
}
