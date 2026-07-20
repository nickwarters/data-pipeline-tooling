// @ts-check
import { h, unsafeHTML } from '../../lib/html.js';

/**
 * @typedef {Object} CompileDrawerProps
 * @property {boolean} open
 * @property {any} bank
 * @property {{ added: number, changed: number, deprecated: number }} diff
 * @property {(bank: any) => string} compile
 * @property {((code: string) => string) | null} highlight
 * @property {((code: string) => Promise<string>) | null} hashCode
 * @property {((bank: any) => Node | null) | null} simulatePanel
 * @property {() => void} onClose
 * @property {() => void} onCopied
 * @property {() => void} onSubmit
 */

/**
 * Pure compile/publish drawer view. State and effects are supplied by the bank
 * route slice; this module owns no custom-element lifecycle or local state.
 * @param {CompileDrawerProps} props
 * @returns {HTMLElement[]}
 */
export function CompileDrawer(props) {
  const code = props.compile(props.bank);
  const hashMeta = h('small', {}, 'hash: …');
  const hashed = props.hashCode
    ? props.hashCode(code)
    : Promise.reject(new Error('no hashCode prop'));
  hashed
    .then((hash) => {
      hashMeta.textContent = `sha256:${hash} · ${code.length} chars · ${code.split('\n').length} lines`;
    })
    .catch(() => {
      hashMeta.textContent = 'hash: unavailable';
    });

  const codeBlock = props.highlight
    ? h('div', { class: 'code-block' }, unsafeHTML(props.highlight(code)))
    : h('div', { class: 'code-block' }, code);

  return [
    h('div', {
      class: 'drawer-backdrop' + (props.open ? ' open' : ''),
      onclick: props.onClose,
    }),
    h(
      'aside',
      { class: 'drawer' + (props.open ? ' open' : '') },
      h(
        'div',
        { class: 'drawer-head' },
        h(
          'div',
          {},
          h('h3', {}, 'Compiled ', h('em', {}, 'bank'), '.'),
          h(
            'p',
            {},
            'Ready for review. This is the exact JSON artifact that will be PR’d into ',
            h(
              'code',
              { className: 'code-inline' },
              'case-types/banks/{slug}.txt'
            ),
            '.'
          )
        ),
        h('button', { class: 'drawer-close', onclick: props.onClose }, '×')
      ),
      h(
        'div',
        { class: 'drawer-body' },
        h(
          'div',
          { class: 'diff-summary' },
          diffCard('diff-card added', String(props.diff.added), 'Added'),
          diffCard('diff-card changed', String(props.diff.changed), 'Changed'),
          diffCard(
            'diff-card removed',
            String(props.diff.deprecated),
            'Deprecated'
          )
        ),
        props.simulatePanel?.(props.bank) ?? null,
        codeBlock
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
                const clipboard = /** @type {any} */ (globalThis).navigator
                  ?.clipboard;
                if (clipboard?.writeText) await clipboard.writeText(code);
                props.onCopied();
              },
            },
            'Copy'
          ),
          h(
            'button',
            { class: 'pill-btn primary', onclick: props.onSubmit },
            'Send for Review'
          )
        )
      )
    ),
  ];
}

/** @param {string} className @param {string} count @param {string} label */
function diffCard(className, count, label) {
  return h(
    'div',
    { class: className },
    h('div', { className: 'n' }, count),
    h('div', { className: 'l' }, label)
  );
}
