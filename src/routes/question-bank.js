// @ts-check

/**
 * @param {import('../router.js').Router} router
 * @param {import('../register-routes.js').AppContext} context
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
