// @ts-check
import { CRElement } from '../components/cr-element.js';
import { el } from './cr-bank-dom.js';
import { drawerOpen } from './question-bank-store.js';

// Side-effect imports: register all child custom elements.
import '../components/cr-case-tabs.js';
import './cr-bank-rail.js';
import './cr-bank-list.js';
import '../components/cr-question-card.js';
import '../components/cr-wording-editor.js';
import '../components/cr-options-editor.js';
import '../components/cr-showwhen-editor.js';
import '../components/cr-showwhen-group.js';
import '../components/cr-showwhen-leaf.js';
import '../components/cr-remediation-editor.js';
import './cr-bank-dock.js';
import '../components/cr-compile-drawer.js';
import '../components/cr-toast.js';

export class CRBankEditor extends CRElement {
  constructor() {
    super();
    /** @type {((e: any) => void) | null} */
    this._key = null;
  }
  connectedCallback() {
    this.replaceChildren(
      el('header', { class: 'masthead' },
        el('div', {},
          el('div', { class: 'eyebrow', html: 'Curator’s Workbench <span class="dot"></span> Question Bank Editorial' }),
          el('h1', { html: 'The Question <em>Bank</em>' }),
        ),
        el('div', { class: 'masthead-meta', html:
          '<strong>Curator</strong>: Case Type Owner<br>' +
          'Session: <strong>local · uncommitted</strong><br>' +
          'Schema: <strong>questions.v3</strong>' }),
      ),
      /** @type {any} */ (document.createElement('cr-case-tabs')),
      el('main', { class: 'bank-main' },
        /** @type {any} */ (document.createElement('cr-bank-rail')),
        /** @type {any} */ (document.createElement('cr-bank-list')),
      ),
      /** @type {any} */ (document.createElement('cr-bank-dock')),
      /** @type {any} */ (document.createElement('cr-compile-drawer')),
      /** @type {any} */ (document.createElement('cr-toast')),
    );

    this._key = (/** @type {any} */ e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault?.(); drawerOpen.set(true); }
      if (e.key === 'Escape') drawerOpen.set(false);
    };
    document.addEventListener('keydown', this._key);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._key) document.removeEventListener('keydown', this._key);
  }
}

customElements.define('cr-bank-editor', CRBankEditor);
