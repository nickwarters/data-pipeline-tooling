// @ts-check
import { ReactiveElement } from '../components/reactive-element.js';
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

// TODO(simplify-ui): Convert this class-backed custom element to the simpler
// function-component model. The target shape is a plain function returning h()
// nodes, wrapped in reactive() only when local signals need to re-render; keep
// custom elements only for route or browser-integration shells.
export class CRBankEditor extends ReactiveElement {
  constructor() {
    super();
    /** @type {((e: any) => void) | null} */
    this._key = null;
  }
  connectedCallback() {
    super.connectedCallback();
    // TODO(simplify-ui): Replace this manual document listener lifecycle with
    // on(document, 'keydown', handler) from src/lib/view.js when this shell's
    // mount/disconnect cleanup is owned by reactive()/defineView().
    this._key = (/** @type {any} */ e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault?.();
        drawerOpen.set(true);
      }
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
}

customElements.define('cr-bank-editor', CRBankEditor);
