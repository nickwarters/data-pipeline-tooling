// @ts-check
import { defineView } from '../../lib/view.js';
import { h, unsafeHTML } from '../../lib/html.js';

/**
 * @typedef {Object} CompileDrawerProps
 * @property {{ get(): boolean } | null} open open/closed state signal
 * @property {{ get(): any } | null} bank the bank to compile (signal)
 * @property {{ get(): { added: number, changed: number, deprecated: number } } | null} diff diff counts signal
 * @property {(bank: any) => string} compile compiles the bank to its artifact JSON
 * @property {((code: string) => string) | null} highlight syntax-highlights code to reviewed HTML
 * @property {((code: string) => Promise<string>) | null} hashCode hashes the compiled artifact
 * @property {((bank: any) => Node | null) | null} simulatePanel renders the impact-simulation panel (or null)
 * @property {() => void} onClose
 * @property {() => void} onCopied
 * @property {() => void} onSubmit
 */

/**
 * Slide-out drawer showing the compiled current Question Bank JSON. All state
 * arrives as props — signals for the reactive parts (`open`, `bank`, `diff`)
 * and plain functions for the bank-editor concerns (`compile`, `highlight`,
 * `hashCode`, `simulatePanel`) — so the component has no store dependency;
 * the bank editor page supplies the wiring (issue #382).
 *
 * @param {CompileDrawerProps} props
 * @returns {HTMLElement[]}
 */
export function CompileDrawer(props) {
  const open = props.open?.get() ?? false;
  const bank = props.bank?.get();
  const code = props.compile(bank);
  const d = props.diff?.get() ?? { added: 0, changed: 0, deprecated: 0 };

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

  // Without a highlighter the code renders as plain text (never raw HTML).
  const codeBlock = props.highlight
    ? h('div', { class: 'code-block' }, unsafeHTML(props.highlight(code)))
    : h('div', { class: 'code-block' }, code);

  return [
    h('div', {
      class: 'drawer-backdrop' + (open ? ' open' : ''),
      onclick: () => props.onClose(),
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
        h(
          'button',
          { class: 'drawer-close', onclick: () => props.onClose() },
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
        props.simulatePanel ? props.simulatePanel(bank) : null,
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
                const clip = /** @type {any} */ (globalThis).navigator
                  ?.clipboard;
                if (clip?.writeText) await clip.writeText(code);
                props.onCopied();
              },
            },
            'Copy'
          ),
          h(
            'button',
            {
              class: 'pill-btn primary',
              onclick: () => props.onSubmit(),
            },
            'Send for Review'
          )
        )
      )
    ),
  ];
}

export const CORACompileDrawer = defineView('cora-compile-drawer', {
  props: /** @type {CompileDrawerProps} */ ({
    open: null,
    bank: null,
    diff: null,
    compile: () => '',
    highlight: null,
    hashCode: null,
    simulatePanel: null,
    onClose: () => {},
    onCopied: () => {},
    onSubmit: () => {},
  }),
  render({ props }) {
    return CompileDrawer(props);
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
