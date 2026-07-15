// @ts-check
// The Question Bank editor is a full-bleed browser-integration shell, so this
// route legitimately mounts the `cora-bank-editor` custom element directly.

import { simulatorEnabled } from '../question-bank/question-bank-flags.js';

/**
 * @param {import('../lib/router.js').Router} router
 * @param {import('../setup/register-routes.js').AppContext} context
 */
export function register(router, context) {
  router.register('#/question-bank', {
    mount(container) {
      context.appEl.classList.add('cora-fullbleed');
      const loadEditor =
        context.loadQuestionBankEditor ??
        (() => import('../question-bank/cora-bank-editor.js'));
      const loadSamples =
        context.loadQuestionBankSamples ??
        (() =>
          import('../question-bank/question-bank-samples.js').then((m) =>
            m.loadSampleCases(context.client, context.allCaseSources)
          ));
      loadEditor().then(() => {
        const el = document.createElement('cora-bank-editor');
        container.replaceChildren(el);
        // Read-only sample fetch for the impact simulator (behind
        // ?simulate=1); the editor is usable while (or if never) it resolves.
        if (simulatorEnabled()) loadSamples();
      });
    },
    unmount() {
      context.appEl.classList.remove('cora-fullbleed');
    },
  });
}
