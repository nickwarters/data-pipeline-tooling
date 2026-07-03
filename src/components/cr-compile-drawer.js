// @ts-check
import { defineView } from '../lib/view.js';
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

/**
 * Slide-out drawer showing the compiled Case Type config. Reads the shared
 * question-bank signals (`drawerOpen`, `currentBank`, `diffCounts`), so it
 * re-renders whenever they change.
 *
 * @returns {HTMLElement[]}
 */
export function CompileDrawer() {
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

export const CRCompileDrawer = defineView('cr-compile-drawer', {
  render() {
    return CompileDrawer();
  },
});

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
