// @ts-check
import { JourneyCasesPage } from '../pages/cora-journey-cases.js';

/**
 * @param {import('../lib/router.js').Router} router
 * @param {import('../setup/register-routes.js').AppContext} context
 */
export function register(router, context) {
  router.register('#/journey-cases', {
    mount(container) {
      // List-scope Journey Owner capability: only a user who
      // owns at least one Case Type as a Journey Owner may see this view.
      if (context.capabilities.ownedJourneyCaseTypes.length === 0) {
        location.hash = '#/';
        return;
      }
      container.replaceChildren(
        JourneyCasesPage({
          client: context.client,
          ownedJourneyCaseTypes: context.capabilities.ownedJourneyCaseTypes,
        })
      );
    },
    unmount() {},
  });
}
