// @ts-check
import { ShellElement } from '../lib/view.js';
import { h } from '../lib/html.js';
import { drawerOpen, railOpen } from './question-bank-store.js';

// Side-effect imports: register all child custom elements.
import '../components/cora-case-tabs.js';
import './cora-bank-rail.js';
import './cora-bank-list.js';
import './cora-outcome-options-editor.js';
import '../components/cora-question-card.js';
import '../components/cora-question-labels.js';
import '../components/cora-wording-editor.js';
import '../components/cora-options-editor.js';
import '../components/cora-showwhen-editor.js';
import '../components/cora-showwhen-group.js';
import '../components/cora-showwhen-leaf.js';
import '../components/cora-remediation-editor.js';
import './cora-bank-dock.js';
import '../components/cora-compile-drawer.js';
import '../components/cora-toast.js';

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
    /** @type {any} */ (document.createElement('cora-case-tabs')),
    h(
      'main',
      { className: 'bank-main' },
      /** @type {any} */ (document.createElement('cora-bank-rail')),
      /** @type {any} */ (document.createElement('cora-bank-list'))
    ),
    /** @type {any} */ (document.createElement('cora-bank-dock')),
    /** @type {any} */ (document.createElement('cora-compile-drawer')),
    /** @type {any} */ (document.createElement('cora-toast')),
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
    if (e.key === 'Escape') {
      drawerOpen.set(false);
      railOpen.set(false);
    }
  };
  target.addEventListener('keydown', key);
  return () => target.removeEventListener('keydown', key);
}

export class CORABankEditor extends ShellElement {
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

customElements.define('cora-bank-editor', CORABankEditor);
