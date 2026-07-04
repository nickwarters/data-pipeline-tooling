// @ts-check
// The Question Bank editor is a full-bleed browser-integration shell, so this
// route legitimately mounts the `cora-bank-editor` custom element directly.

/**
 * @param {import('../lib/router.js').Router} router
 * @param {import('../setup/register-routes.js').AppContext} context
 */
export function register(router, context) {
  router.register('#/question-bank', {
    mount(container) {
      context.appEl.classList.add('cora-fullbleed');
      const el = document.createElement('cora-bank-editor');
      container.replaceChildren(el);
    },
    unmount() {
      context.appEl.classList.remove('cora-fullbleed');
    },
  });
}
