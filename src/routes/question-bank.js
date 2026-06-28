// @ts-check
// TODO(simplify-ui): Rework routing around route functions that compose
// plain function components returning h() nodes. Keep custom elements only for
// route/browser-integration shells, not as the unit every route has to create.

/**
 * @param {import('../lib/router.js').Router} router
 * @param {import('../setup/register-routes.js').AppContext} context
 */
export function register(router, context) {
  router.register('#/question-bank', {
    mount(container) {
      context.appEl.classList.add('cr-fullbleed');
      const el = document.createElement('cr-bank-editor');
      container.replaceChildren(el);
    },
    unmount() {
      context.appEl.classList.remove('cr-fullbleed');
    },
  });
}
