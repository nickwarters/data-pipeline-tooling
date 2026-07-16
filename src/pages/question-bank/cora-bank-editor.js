// @ts-check
import { ShellElement } from '../../lib/view.js';
import { h } from '../../lib/html.js';
import {
  activeSlug,
  baseline,
  baselineBank,
  cases,
  currentBank,
  diffCounts,
  drawerOpen,
  isDirty,
  railOpen,
  sampleCases,
  setFilters,
  showToast,
} from './question-bank-store.js';
import { compileBank, hashStr, highlight } from './question-bank-compile.js';
import { simulatorEnabled } from './question-bank-flags.js';
import { SimulatePanel } from './simulate-panel.js';

// Side-effect imports: register all child custom elements.
import '../../components/collections/cora-case-tabs.js';
import './cora-bank-rail.js';
import './cora-bank-list.js';
import './cora-outcome-options-editor.js';
import '../../components/sections/cora-question-card.js';
import '../../components/base/cora-question-labels.js';
import '../../components/sections/cora-wording-editor.js';
import '../../components/base/cora-options-editor.js';
import '../../components/sections/cora-showwhen-editor.js';
import '../../components/sections/cora-showwhen-group.js';
import '../../components/base/cora-showwhen-leaf.js';
import '../../components/sections/cora-remediation-editor.js';
import './cora-bank-dock.js';
import '../../components/collections/cora-compile-drawer.js';
import '../../components/base/cora-toast.js';

/**
 * Switch the workbench to another Case Type's bank (clears the category
 * filter, which is per-bank).
 *
 * @param {string} slug
 */
export function selectBank(slug) {
  activeSlug.set(slug);
  setFilters({ category: null });
}

/** Discard all uncommitted edits and return to the last synced state. */
export function revertBank() {
  if (!isDirty.get()) {
    showToast('Nothing to revert');
    return;
  }
  const ok = /** @type {any} */ (globalThis).confirm?.(
    'Discard all uncommitted edits and return to the last synced state?'
  );
  if (!ok) return;
  cases.set(structuredClone(baseline.get()));
  showToast('Reverted to baseline');
}

/** Snapshot the draft as the new baseline and close the drawer. */
export function submitBankForReview() {
  baseline.set(structuredClone(cases.get()));
  drawerOpen.set(false);
  showToast('Submitted for review');
}

/**
 * Store wiring for the `cora-case-tabs` collection: state flows down as
 * signals, interactions flow back up into the store the page owns.
 *
 * @returns {Partial<import('../../components/collections/cora-case-tabs.js').CORACaseTabs>}
 */
export function caseTabsProps() {
  return {
    cases,
    active: activeSlug,
    dirty: isDirty,
    onSelect: selectBank,
    onRevert: revertBank,
    onCompile: () => drawerOpen.set(true),
  };
}

/**
 * Store + compile/flags/simulate wiring for the `cora-compile-drawer`
 * collection. The drawer itself is a props-driven component; the bank-editor
 * page owns the assembly (issue #382).
 *
 * @returns {import('../../components/collections/cora-compile-drawer.js').CompileDrawerProps}
 */
export function compileDrawerProps() {
  return {
    open: drawerOpen,
    bank: currentBank,
    diff: diffCounts,
    compile: compileBank,
    highlight,
    hashCode: hashStr,
    simulatePanel: (/** @type {any} */ bank) =>
      simulatorEnabled()
        ? SimulatePanel(
            baselineBank.get(),
            bank,
            sampleCases.get()[bank.slug] ?? []
          )
        : null,
    onClose: () => drawerOpen.set(false),
    onCopied: () => showToast('Bank JSON copied to clipboard'),
    onSubmit: submitBankForReview,
  };
}

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
    h('cora-case-tabs', caseTabsProps()),
    h(
      'main',
      { className: 'bank-main' },
      /** @type {any} */ (document.createElement('cora-bank-rail')),
      /** @type {any} */ (document.createElement('cora-bank-list'))
    ),
    /** @type {any} */ (document.createElement('cora-bank-dock')),
    h('cora-compile-drawer', compileDrawerProps()),
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
