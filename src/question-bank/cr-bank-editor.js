// @ts-check
import { ReactiveElement } from '../components/reactive-element.js';
import { h } from '../lib/html.js';
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

export class CRBankEditor extends ReactiveElement {
  constructor() {
    super();
    /** @type {((e: any) => void) | null} */
    this._key = null;
  }
  connectedCallback() {
    super.connectedCallback();
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
  render() {
    return [
      h('header', { className: 'masthead' },
        h('div', {},
          h('div', { className: 'eyebrow', innerHTML: 'Case Type Owner <span class="dot"></span> Question Bank' }),
          h('h1', { innerHTML: 'Question <em>Bank</em>' }),
        ),
        h('div', { className: 'masthead-meta', innerHTML:
          'Session: <strong>local · uncommitted</strong><br>' +
          'Schema: <strong>questions.v3</strong>' }),
      ),
      /** @type {any} */ (document.createElement('cr-case-tabs')),
      h('main', { className: 'bank-main' },
        /** @type {any} */ (document.createElement('cr-bank-rail')),
        /** @type {any} */ (document.createElement('cr-bank-list')),
      ),
      /** @type {any} */ (document.createElement('cr-bank-dock')),
      /** @type {any} */ (document.createElement('cr-compile-drawer')),
      /** @type {any} */ (document.createElement('cr-toast')),
    ];
  }
}

customElements.define('cr-bank-editor', CRBankEditor);
