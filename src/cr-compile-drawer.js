// @ts-check
import { CRElement } from './cr-element.js';
import { el, reactive } from './cr-bank-dom.js';
import { baseline, cases, currentBank, diffCounts, drawerOpen, showToast } from './question-bank-store.js';
import { compileBank, hashStr, highlight } from './question-bank-compile.js';

export class CRCompileDrawer extends CRElement {
  connectedCallback() { reactive(this, () => this._render()); }
  _render() {
    const open = drawerOpen.get();
    const bank = currentBank.get();
    const code = compileBank(bank);
    const d = diffCounts.get();

    const backdrop = el('div', { class: 'drawer-backdrop' + (open ? ' open' : ''),
      onclick: () => drawerOpen.set(false) });

    const codeBlock = el('div', { class: 'code-block', html: highlight(code) });
    const hashMeta = el('small', {}, 'hash: …');
    hashStr(code).then(h => {
      hashMeta.textContent = `sha256:${h} · ${code.length} chars · ${code.split('\n').length} lines`;
    }).catch(() => { hashMeta.textContent = 'hash: unavailable'; });

    const drawer = el('aside', { class: 'drawer' + (open ? ' open' : '') },
      el('div', { class: 'drawer-head' },
        el('div', {},
          el('h3', { html: 'Compiled <em>config</em>.' }),
          el('p', { html: 'Ready for review. This is the exact module body that will be PR’d into <code class="code-inline">case-types/</code>.' }),
        ),
        el('button', { class: 'drawer-close', onclick: () => drawerOpen.set(false) }, '×'),
      ),
      el('div', { class: 'drawer-body' },
        el('div', { class: 'diff-summary' },
          el('div', { class: 'diff-card added',   html: `<div class="n">${d.added}</div><div class="l">Added</div>` }),
          el('div', { class: 'diff-card changed', html: `<div class="n">${d.changed}</div><div class="l">Changed</div>` }),
          el('div', { class: 'diff-card removed', html: `<div class="n">${d.deprecated}</div><div class="l">Deprecated</div>` }),
        ),
        codeBlock,
      ),
      el('div', { class: 'drawer-foot' },
        hashMeta,
        el('div', { class: 'drawer-foot-actions' },
          el('button', { class: 'pill-btn', onclick: async () => {
            const clip = (/** @type {any} */ (globalThis)).navigator?.clipboard;
            if (clip?.writeText) await clip.writeText(code);
            showToast('Config copied to clipboard');
          } }, 'Copy'),
          el('button', { class: 'pill-btn primary', onclick: () => {
            baseline.set(structuredClone(cases.get()));
            drawerOpen.set(false);
            showToast('Submitted for review');
          } }, 'Send for Review'),
        ),
      ),
    );

    this.replaceChildren(backdrop, drawer);
  }
}

customElements.define('cr-compile-drawer', CRCompileDrawer);
