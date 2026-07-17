// @ts-check
// The Question Bank editor is a full-bleed browser-integration shell, so this
// route legitimately mounts the `cora-bank-editor` custom element directly.
// Like every other route, its page code (editor + feature flags) loads inside
// mount() via dynamic import(), so a broken editor surfaces only here — the
// router error boundary renders the cora-route-error panel.

/**
 * @param {import('../lib/router.js').Router} router
 * @param {import('../setup/register-routes.js').AppContext} context
 */
export function register(router, context) {
  router.register('#/question-bank', {
    async mount(container) {
      context.appEl.classList.add('cora-fullbleed');
      const loadEditor =
        context.loadQuestionBankEditor ??
        (() => import('../pages/question-bank/cora-bank-editor.js'));
      const loadSamples =
        context.loadQuestionBankSamples ??
        (() =>
          import('../pages/question-bank/question-bank-samples.js').then((m) =>
            m.loadSampleCases(context.client, context.caseSources)
          ));
      await loadEditor();
      const el = document.createElement('cora-bank-editor');
      container.replaceChildren(el);
      // Read-only sample fetch for the impact simulator (behind ?simulate=1);
      // the editor is usable while (or if never) it resolves.
      const { simulatorEnabled } =
        await import('../pages/question-bank/question-bank-flags.js');
      if (simulatorEnabled()) await loadSamples();
    },
    unmount() {
      context.appEl.classList.remove('cora-fullbleed');
    },
  });
}
