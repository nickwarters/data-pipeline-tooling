// @ts-check
import { ShellElement } from '../lib/view.js';
import { h } from '../lib/html.js';
import { drawerOpen } from './question-bank-store.js';

// Side-effect imports: register all child custom elements.
import '../components/cr-case-tabs.js';
import './cr-bank-rail.js';
import './cr-bank-list.js';
import './cr-outcome-options-editor.js';
import '../components/cr-question-card.js';
import '../components/cr-question-labels.js';
import '../components/cr-wording-editor.js';
import '../components/cr-options-editor.js';
import '../components/cr-showwhen-editor.js';
import '../components/cr-showwhen-group.js';
import '../components/cr-showwhen-leaf.js';
import '../components/cr-remediation-editor.js';
import './cr-bank-dock.js';
import '../components/cr-compile-drawer.js';
import '../components/cr-toast.js';

/**
 * @returns {Node[]}
 */
export function BankEditor() {
  return [
    h(
      'header',
      { className: 'masthead' },
      h(
        'div',
        {},
        h(
          'div',
          { className: 'eyebrow' },
          'Case Type Owner ',
          h('span', { className: 'dot' }),
          ' Question Bank'
        ),
        h('h1', {}, 'Question ', h('em', {}, 'Bank'))
      ),
      h(
        'div',
        { className: 'masthead-meta' },
        'Session: ',
        h('strong', {}, 'local · uncommitted'),
        h('br'),
        'Schema: ',
        h('strong', {}, 'questions.v3')
      )
    ),
    /** @type {any} */ (document.createElement('cr-case-tabs')),
    h(
      'main',
      { className: 'bank-main' },
      /** @type {any} */ (document.createElement('cr-bank-rail')),
      /** @type {any} */ (document.createElement('cr-bank-list'))
    ),
    /** @type {any} */ (document.createElement('cr-bank-dock')),
    /** @type {any} */ (document.createElement('cr-compile-drawer')),
    /** @type {any} */ (document.createElement('cr-toast')),
  ];
}

/**
 * @param {{ addEventListener(type: string, listener: (e: any) => void): void, removeEventListener(type: string, listener: (e: any) => void): void }} target
 * @returns {() => void}
 */
export function bindBankEditorKeys(target) {
  const key = (/** @type {any} */ e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault?.();
      drawerOpen.set(true);
    }
    if (e.key === 'Escape') drawerOpen.set(false);
  };
  target.addEventListener('keydown', key);
  return () => target.removeEventListener('keydown', key);
}

export class CRBankEditor extends ShellElement {
  constructor() {
    super();
    /** @type {(() => void) | null} */
    this._key = null;
  }
  connectedCallback() {
    super.connectedCallback();
    this._key = bindBankEditorKeys(document);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this._key?.();
    this._key = null;
  }
  render() {
    return BankEditor();
  }
}

customElements.define('cr-bank-editor', CRBankEditor);
