// @ts-check
import { ReactiveElement } from './reactive-element.js';
import { h, unsafeHTML } from '../lib/html.js';
import {
  baseline,
  cases,
  currentBank,
  diffCounts,
  drawerOpen,
  showToast,
} from '../question-bank/question-bank-store.js';
import {
  compileBank,
  hashStr,
  highlight,
} from '../question-bank/question-bank-compile.js';

// TODO(simplify-ui): Convert this class-backed custom element to the simpler
// function-component model. The target shape is a plain function returning h()
// nodes, wrapped in reactive() only when local signals need to re-render; keep
// custom elements only for route or browser-integration shells.
export class CRCompileDrawer extends ReactiveElement {
  _render() {
    const content = this.render();
    if (content !== undefined) {
      if (content && typeof content === 'object' && 'appendChild' in content) {
        this.replaceChildren(/** @type {any} */ (content));
      } else if (Array.isArray(content)) {
        this.replaceChildren(...content);
      } else {
        this.replaceChildren();
      }
    }
  }

  render() {
    const open = drawerOpen.get();
    const bank = currentBank.get();
    const code = compileBank(bank);
    const d = diffCounts.get();

    const hashMeta = h('small', {}, 'hash: …');
    hashStr(code)
      .then((hash) => {
        hashMeta.textContent = `sha256:${hash} · ${code.length} chars · ${code.split('\n').length} lines`;
      })
      .catch(() => {
        hashMeta.textContent = 'hash: unavailable';
      });

    return [
      h('div', {
        class: 'drawer-backdrop' + (open ? ' open' : ''),
        onclick: () => drawerOpen.set(false),
      }),
      h(
        'aside',
        { class: 'drawer' + (open ? ' open' : '') },
        h(
          'div',
          { class: 'drawer-head' },
          h(
            'div',
            {},
            h('h3', {}, 'Compiled ', h('em', {}, 'config'), '.'),
            h(
              'p',
              {},
              'Ready for review. This is the exact module body that will be PR’d into ',
              h('code', { className: 'code-inline' }, 'case-types/'),
              '.'
            )
          ),
          h(
            'button',
            { class: 'drawer-close', onclick: () => drawerOpen.set(false) },
            '×'
          )
        ),
        h(
          'div',
          { class: 'drawer-body' },
          h(
            'div',
            { class: 'diff-summary' },
            diffCard('diff-card added', String(d.added), 'Added'),
            diffCard('diff-card changed', String(d.changed), 'Changed'),
            diffCard('diff-card removed', String(d.deprecated), 'Deprecated')
          ),
          h('div', { class: 'code-block' }, unsafeHTML(highlight(code)))
        ),
        h(
          'div',
          { class: 'drawer-foot' },
          hashMeta,
          h(
            'div',
            { class: 'drawer-foot-actions' },
            h(
              'button',
              {
                class: 'pill-btn',
                onclick: async () => {
                  const clip = /** @type {any} */ (globalThis).navigator
                    ?.clipboard;
                  if (clip?.writeText) await clip.writeText(code);
                  showToast('Config copied to clipboard');
                },
              },
              'Copy'
            ),
            h(
              'button',
              {
                class: 'pill-btn primary',
                onclick: () => {
                  baseline.set(structuredClone(cases.get()));
                  drawerOpen.set(false);
                  showToast('Submitted for review');
                },
              },
              'Send for Review'
            )
          )
        )
      ),
    ];
  }
}

customElements.define('cr-compile-drawer', CRCompileDrawer);

/**
 * @param {string} className
 * @param {string} count
 * @param {string} label
 */
function diffCard(className, count, label) {
  return h(
    'div',
    { class: className },
    h('div', { className: 'n' }, count),
    h('div', { className: 'l' }, label)
  );
}
