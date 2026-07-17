// @ts-check
import { ShellElement, replaceHostChildren } from '../../lib/view.js';
import { h } from '../../lib/html.js';
import { EmptyState } from '../../lib/empty-state.js';
import { evaluate } from '../../evaluators/applicability-evaluator.js';
import { isFailure } from '../../evaluators/failure-evaluator.js';
import { buildCaptureControl } from '../../lib/capture-engine.js';
import { AttributeMenu } from './cora-attribute-menu.js';
import './cora-capture-groups.js';

import { normaliseConfiguredActions } from '../../evaluators/configured-outcome.js';

/** @typedef {import('../../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {{ loginName: string, displayName: string }} Party */

/**
 * @typedef {object} RemediationSectionProps
 * @property {QuestionDefinition[]} catalogue
 * @property {Record<string, Answer>} answers
 * @property {boolean} attributeFailures
 * @property {SharePointClient | null} client
 * @property {Party | null} responsibleParty
 * @property {boolean} canAttribute
 * @property {import('../../sharepoint-client.js').RemediationField[]} remediationFields
 * @property {boolean} canCaptureDetails
 * @property {import('../../sharepoint-client.js').CaptureGroup[]} captureGroups
 * @property {boolean} canCapture
 * @property {Map<string, import('./cora-capture-groups.js').CORACaptureGroups>} captureEls
 * @property {boolean} canSelectRemediation
 * @property {(questionId: string, fieldKey: string, value: string) => void} dispatchCapture
 * @property {(questionId: string, key: string, value: string) => void} dispatchDetail
 * @property {(questionId: string, attributedParty: Party | null) => void} dispatchAttribute
 * @property {(questionId: string, action: { id: string, text: string }, selected: boolean) => void} dispatchRemediationAction
 * @property {(questionId: string, value: string) => void} dispatchRemediationFreeForm
 */

/**
 * The Applicable Questions whose Answers currently fail, in catalogue order.
 * This ordered id set is what decides between a full list rebuild and an
 * in-place item patch (issue #308).
 *
 * @param {RemediationSectionProps} props
 * @returns {QuestionDefinition[]}
 */
export function failedQuestions(props) {
  const applicable = evaluate(props.catalogue, props.answers);
  return props.catalogue.filter(
    (q) => applicable.has(q.id) && isFailure(q, props.answers[q.id])
  );
}

/**
 * @param {RemediationSectionProps} props
 * @returns {Node[]}
 */
export function RemediationSection(props) {
  const failed = failedQuestions(props);

  const heading = h('h2', {}, 'Failures');

  if (failed.length === 0) {
    const empty = EmptyState('No failures.', {
      className: 'cora-remediation-empty',
    });
    return [heading, empty];
  }

  const list = h('ul', { class: 'cora-remediation-list' });
  for (const q of failed) {
    list.appendChild(renderRemediationItem(props, q));
  }
  return [heading, list];
}

/**
 * @param {RemediationSectionProps} props
 * @param {QuestionDefinition} q
 * @returns {HTMLElement}
 */
export function renderRemediationItem(props, q) {
  const li = h('li', { class: 'cora-remediation-item' });
  const { before, after } = buildItemContent(props, q);

  for (const node of before) li.appendChild(node);
  if (props.captureGroups?.length) {
    renderRemediationCapture(props, li, q);
  }
  for (const node of after) li.appendChild(node);

  return li;
}

/**
 * Builds a failed item's content around its capture slot: `before` is
 * everything rendered above the `cora-capture-groups` element (question,
 * answer, attribution, details), `after` everything below (Remediation
 * Actions). Split out so {@link updateRemediationItem} can refresh both sides
 * in place without ever detaching the reused capture element between them
 * (issue #308).
 *
 * @param {RemediationSectionProps} props
 * @param {QuestionDefinition} q
 * @returns {{ before: Node[], after: Node[] }}
 */
function buildItemContent(props, q) {
  const before = h('div', {});
  if (q.questionGroup) {
    before.appendChild(
      h('p', { class: 'cora-remediation-group' }, q.questionGroup)
    );
  }
  before.appendChild(h('p', { class: 'cora-remediation-question' }, q.text));

  const v = props.answers[q.id]?.value;
  const ansText = `Answer: ${Array.isArray(v) ? v.join(', ') : (v ?? '')}`;
  before.appendChild(h('p', { class: 'cora-remediation-answer' }, ansText));

  if (props.attributeFailures) {
    renderRemediationAttribution(props, before, q);
  }
  if (props.remediationFields?.length) {
    renderRemediationDetails(props, before, q);
  }

  const after = h('div', {});
  renderRemediationActions(props, after, q);

  return { before: [...before.childNodes], after: [...after.childNodes] };
}

/**
 * Refreshes an already-rendered failed item in place. The reused
 * `cora-capture-groups` element stays attached to its `<li>` throughout — its
 * own `update()` syncs new values into the live controls — while the plain
 * content on either side is rebuilt. Keeping the capture subtree connected is
 * what preserves the Reviewer's focus and the browser's scroll anchoring
 * across an autosave re-render (issue #308).
 *
 * @param {RemediationSectionProps} props
 * @param {HTMLElement} li
 * @param {QuestionDefinition} q
 */
export function updateRemediationItem(props, li, q) {
  const cg = props.captureGroups?.length ? syncCaptureElement(props, q) : null;
  const { before, after } = buildItemContent(props, q);

  const anchor = cg && cg.parentNode === li ? cg : null;
  for (const child of [...li.childNodes]) {
    if (child !== anchor) li.removeChild(child);
  }
  for (const node of before) li.insertBefore(node, anchor);
  if (cg && !anchor) li.appendChild(cg);
  for (const node of after) li.appendChild(node);
}

/**
 * Renders the reviewer-selectable **Remediation Actions** for a failed item
 *. Each configured action is an independent checkbox, unticked
 * unless the reviewer has already selected it (i.e. its id is present on
 * `answer.remediationActions`); ticking/unticking re-dispatches a bubbling
 * `cora-remediation-action` so the page persists the selected subset onto the
 * Answer. When the Question opts into free-form remediation, an extra text
 * input lets the reviewer add their own action. Read-only viewers see only the
 * selected canned actions and any captured free-form text, both as plain text.
 *
 * @param {RemediationSectionProps} props
 * @param {HTMLElement} li
 * @param {QuestionDefinition} q
 */
export function renderRemediationActions(props, li, q) {
  const answer = props.answers[q.id];
  const selectedIds = new Set(
    (answer?.remediationActions ?? []).map((action) => action.id)
  );
  const configured = normaliseConfiguredActions(
    q.remediationActions ?? [],
    q.id
  );
  const editable = props.canSelectRemediation;
  const visible = editable
    ? configured
    : configured.filter((action) => selectedIds.has(action.id));

  if (visible.length) {
    li.appendChild(
      h(
        'p',
        { class: 'cora-remediation-actions-heading' },
        'Remediation Actions'
      )
    );
    const actions = h('ul', { class: 'cora-remediation-actions' });
    for (const action of visible) {
      actions.appendChild(
        editable
          ? renderRemediationActionCheckbox(
              props,
              q,
              action,
              selectedIds.has(action.id)
            )
          : h('li', { class: 'cora-remediation-action' }, action.text)
      );
    }
    li.appendChild(actions);
  }

  if (q.allowFreeFormRemediation) {
    renderRemediationFreeForm(props, li, q, answer?.freeFormRemediation ?? '');
  }
}

/**
 * @param {RemediationSectionProps} props
 * @param {QuestionDefinition} q
 * @param {import('../../sharepoint-client.js').RemediationActionDefinition} action
 * @param {boolean} checked
 * @returns {HTMLElement}
 */
function renderRemediationActionCheckbox(props, q, action, checked) {
  return h(
    'li',
    { class: 'cora-remediation-action' },
    h(
      'label',
      {},
      h('input', {
        type: 'checkbox',
        class: 'cora-remediation-action-checkbox',
        checked,
        onchange: (/** @type {any} */ event) => {
          props.dispatchRemediationAction(
            q.id,
            { id: action.id, text: action.text },
            event.target.checked
          );
        },
      }),
      h('span', {}, ` ${action.text}`)
    )
  );
}

/**
 * @param {RemediationSectionProps} props
 * @param {HTMLElement} li
 * @param {QuestionDefinition} q
 * @param {string} value
 */
function renderRemediationFreeForm(props, li, q, value) {
  if (!props.canSelectRemediation) {
    if (value) {
      li.appendChild(
        h('p', { class: 'cora-remediation-freeform-value' }, value)
      );
    }
    return;
  }

  li.appendChild(
    h(
      'div',
      { class: 'cora-remediation-freeform' },
      h(
        'label',
        { class: 'cora-remediation-freeform-label' },
        'Free-form action'
      ),
      h('input', {
        type: 'text',
        class: 'cora-remediation-freeform-input',
        value,
        placeholder: 'Describe a remediation in your own words…',
        onchange: (/** @type {any} */ event) => {
          props.dispatchRemediationFreeForm(q.id, event.target.value);
        },
      })
    )
  );
}

/**
 * @param {RemediationSectionProps} props
 * @param {HTMLElement} li
 * @param {QuestionDefinition} q
 */
export function renderRemediationAttribution(props, li, q) {
  const attributedParty = props.answers[q.id]?.attributedParty;

  if (!props.canAttribute) {
    if (attributedParty) {
      li.appendChild(
        h(
          'p',
          { class: 'cora-remediation-attributed-party' },
          `Attributed to: ${attributedParty.displayName}`
        )
      );
    }
    return;
  }

  const menu = AttributeMenu({
    client: props.client,
    responsibleParty: props.responsibleParty,
    attributedParty: attributedParty ?? null,
    onChange: (/** @type {Party | null} */ party) => {
      props.dispatchAttribute(q.id, party);
    },
  });
  li.appendChild(/** @type {any} */ (menu));
}

/**
 * @param {RemediationSectionProps} props
 * @param {HTMLElement} li
 * @param {QuestionDefinition} q
 */
export function renderRemediationDetails(props, li, q) {
  const details = props.answers[q.id]?.remediationDetails ?? {};

  for (const field of props.remediationFields) {
    if (!props.canCaptureDetails) {
      const captured = details[field.key];
      if (captured === undefined || captured === '') continue;
      li.appendChild(
        h(
          'p',
          { class: 'cora-remediation-detail-value' },
          `${field.label}: ${captured}`
        )
      );
      continue;
    }

    const control = buildCaptureControl(
      field,
      details[field.key] ?? '',
      (value) => {
        props.dispatchDetail(q.id, field.key, value);
      },
      'cora-remediation-detail-input'
    );

    const wrap = h(
      'div',
      { class: 'cora-remediation-detail-field' },
      h('label', { class: 'cora-remediation-detail-label' }, field.label),
      control
    );

    li.appendChild(wrap);
  }
}

/**
 * @param {RemediationSectionProps} props
 * @param {HTMLElement} li
 * @param {QuestionDefinition} q
 */
export function renderRemediationCapture(props, li, q) {
  li.appendChild(/** @type {any} */ (syncCaptureElement(props, q)));
}

/**
 * Gets (or lazily creates) the question's reused `cora-capture-groups`
 * instance and pushes the current capture state into it. Separated from
 * {@link renderRemediationCapture} so the in-place patch can refresh the
 * element without re-appending it (issue #308).
 *
 * @param {RemediationSectionProps} props
 * @param {QuestionDefinition} q
 * @returns {import('./cora-capture-groups.js').CORACaptureGroups}
 */
function syncCaptureElement(props, q) {
  let cg = props.captureEls.get(q.id);
  if (!cg) {
    cg = /** @type {import('./cora-capture-groups.js').CORACaptureGroups} */ (
      h('cora-capture-groups', {
        'oncora-capture': (/** @type {any} */ ev) => {
          /** @type {any} */ (ev).stopPropagation?.();
          const { fieldKey, value } =
            /** @type {CustomEvent<{ fieldKey: string, value: string }>} */ (ev)
              .detail;
          props.dispatchCapture(q.id, fieldKey, value);
        },
      })
    );
    props.captureEls.set(q.id, cg);
  }
  const capture = props.answers[q.id]?.capture ?? {};
  cg.groups = props.captureGroups;
  cg.capture = capture;
  cg.canCapture = props.canCapture;
  cg.update?.(props.captureGroups, capture, props.canCapture);
  return cg;
}

export class CORARemediationSection extends ShellElement {
  constructor() {
    super();
    /** @type {QuestionDefinition[]} */
    this.catalogue = [];
    /** @type {Record<string, Answer>} */
    this.answers = {};
    /** @type {boolean} Whether this Case Type attributes failures to a person. */
    this.attributeFailures = false;
    /** @type {SharePointClient | null} Backs the embedded people picker. */
    this.client = null;
    /**
     * The Case's Responsible Party, offered as a one-click quick-pick in each
     * attribute menu. `null` when the Case has none. the architecture decision.
     * @type {Party | null}
     */
    this.responsibleParty = null;
    /**
     * Whether the viewer may set/change/clear the Attributed Party: Assigned
     * Reviewer only, on an In-progress Case (frozen at completion). UX-only per
     * the architecture decision/0011; the server ACL is the real boundary.
     * @type {boolean}
     */
    this.canAttribute = false;
    /**
     * The Case Type's configurable per-failure capture fields. One
     * shared set applies to every failed Answer; empty when the Case Type
     * declares none.
     * @type {import('../../sharepoint-client.js').RemediationField[]}
     */
    this.remediationFields = [];
    /**
     * Whether the viewer may capture Remediation Details. Mirrors `canAttribute`:
     * Assigned Reviewer only, on an In-progress Case (frozen at completion).
     * @type {boolean}
     */
    this.canCaptureDetails = false;
    /**
     * The Case Type's unified **Issue Capture Group**s. Empty when the
     * Case Type declares none. Both `captureGroups` and `remediationFields` may coexist.
     * @type {import('../../sharepoint-client.js').CaptureGroup[]}
     */
    this.captureGroups = [];
    /**
     * Whether the viewer may capture Issue Capture values. Mirrors `canAttribute`:
     * Assigned Reviewer only, on an In-progress Case (frozen at completion).
     * @type {boolean}
     */
    this.canCapture = false;
    /**
     * Whether the viewer may select which Remediation Actions apply to a failed
     * Answer and add a free-form action. Assigned Reviewer only, on
     * a not-yet-reportable Case; read-only viewers see the selected subset.
     * @type {boolean}
     */
    this.canSelectRemediation = false;
    /**
     * Per-failed-Answer `cora-capture-groups` instances, keyed by question id and
     * reused across re-renders so each group's ephemeral collapse state survives
     * an autosave-triggered re-render.
     * @type {Map<string, import('./cora-capture-groups.js').CORACaptureGroups>}
     */
    this._captureEls = new Map();
    /**
     * The rendered `<li>` per failed question id, reused by the in-place patch
     * (issue #308).
     * @type {Map<string, HTMLElement>}
     */
    this._items = new Map();
    /**
     * The Answer reference each item was last rendered with; an unchanged
     * reference means the item needs no patch (answers updates are immutable).
     * @type {Map<string, Answer | undefined>}
     */
    this._renderedAnswers = new Map();
    /**
     * Structure signature of the last full render, `null` before the first.
     * A matching signature on the next render means only Answer values can
     * have changed, so items are patched in place instead of rebuilt.
     * @type {string | null}
     */
    this._renderedStructure = null;
  }

  /**
   * A stable string describing the list *structure*: the ordered failed
   * question ids plus every prop that changes an item's internal shape. While
   * two renders share a signature, a re-render can only mean changed Answer
   * values, which the in-place patch handles without detaching the reused
   * `cora-capture-groups` elements (issue #308).
   *
   * @param {RemediationSectionProps} props
   * @param {QuestionDefinition[]} failed
   * @returns {string}
   */
  _structureSignature(props, failed) {
    return JSON.stringify([
      failed.map((q) => q.id),
      props.attributeFailures,
      props.canAttribute,
      props.canCaptureDetails,
      props.canCapture,
      props.canSelectRemediation,
      (props.remediationFields ?? []).length,
      (props.captureGroups ?? []).length,
      props.responsibleParty?.loginName ?? null,
    ]);
  }

  /**
   * @param {QuestionDefinition[]} catalogue
   * @param {Record<string, Answer>} answers
   * @param {boolean} [attributeFailures]
   */
  update(catalogue, answers, attributeFailures = false) {
    this.catalogue = catalogue;
    this.answers = answers;
    this.attributeFailures = attributeFailures;
    this._render();
  }

  /**
   * Survives (not routed through `this._shellRenderNow`): several tests call
   * `update()` before `connectedCallback()`, so this must render unconditionally
   * rather than being a no-op pre-connection like the base `update()`.
   *
   * While the structure signature is unchanged, changed items are patched in
   * place — the reused `cora-capture-groups` elements are never detached, so
   * the Reviewer's focus and the browser's scroll anchoring survive a
   * capture-value autosave (issue #308). Any structural change (the failed set,
   * or a shape-changing prop) falls back to the full rebuild.
   */
  _render() {
    const props = this._buildProps();
    const failed = failedQuestions(props);
    if (
      this._renderedStructure !== null &&
      this._renderedStructure === this._structureSignature(props, failed)
    ) {
      this._patchItems(props, failed);
      return;
    }
    replaceHostChildren(this, this.render());
  }

  render() {
    const props = this._buildProps();
    const failed = failedQuestions(props);
    const nodes = RemediationSection(props);
    this._indexItems(props, failed, nodes);
    return nodes;
  }

  /**
   * Records what a full render produced — the `<li>` per failed question, the
   * Answer each was rendered with, and the structure signature — so the next
   * `_render()` can patch in place.
   *
   * @param {RemediationSectionProps} props
   * @param {QuestionDefinition[]} failed
   * @param {Node[]} nodes
   */
  _indexItems(props, failed, nodes) {
    this._items.clear();
    this._renderedAnswers.clear();
    const lis = nodes.flatMap((node) => [
      .../** @type {HTMLElement} */ (node).querySelectorAll(
        '.cora-remediation-item'
      ),
    ]);
    failed.forEach((q, i) => {
      this._items.set(q.id, /** @type {HTMLElement} */ (lis[i]));
      this._renderedAnswers.set(q.id, props.answers[q.id]);
    });
    this._renderedStructure = this._structureSignature(props, failed);
  }

  /**
   * In-place update path: refresh only the items whose Answer reference
   * changed, leaving every other item's DOM untouched.
   *
   * @param {RemediationSectionProps} props
   * @param {QuestionDefinition[]} failed
   */
  _patchItems(props, failed) {
    for (const q of failed) {
      const li = this._items.get(q.id);
      if (!li || props.answers[q.id] === this._renderedAnswers.get(q.id)) {
        continue;
      }
      updateRemediationItem(props, li, q);
      this._renderedAnswers.set(q.id, props.answers[q.id]);
    }
  }

  /**
   * @param {QuestionDefinition} q
   * @returns {HTMLElement}
   */
  _renderItem(q) {
    return renderRemediationItem(this._buildProps(), q);
  }

  /**
   * Renders the Attributed Party surface on a failed item. Read-only
   * viewers see just the cached displayName. Editors get the inline
   * `cora-attribute-menu`, always visible, offering the Responsible Party
   * quick-pick and people search; its `cora-attribute-change` is re-dispatched
   * here as a bubbling `cora-attribute` carrying the question id.
   * Persistence is the page's responsibility so the answers signal stays the
   * single source of truth.
   *
   * @param {HTMLElement} li
   * @param {QuestionDefinition} q
   */
  _renderAttribution(li, q) {
    renderRemediationAttribution(this._buildProps(), li, q);
  }

  /**
   * Renders the configurable Remediation Details surface on a failed item
   *. This slice is a minimal capture surface: editors get one control
   * per declared field (text input or select); read-only viewers see only the
   * fields that already carry a captured value. Persistence is the page's
   * responsibility (it owns the answers signal), so each change is re-dispatched
   * as a bubbling `cora-remediation-detail` carrying the question id, field key,
   * and new value.
   *
   * @param {HTMLElement} li
   * @param {QuestionDefinition} q
   */
  _renderDetails(li, q) {
    renderRemediationDetails(this._buildProps(), li, q);
  }

  /**
   * Renders the unified **Issue Capture Group**s for a failed item
   * via the `cora-capture-groups` component. The instance is reused per question id
   * so each group's ephemeral collapse state survives autosave re-renders. The
   * component's bubbling `cora-capture` (field key + value) is caught here and
   * re-dispatched as a `cora-capture` carrying the question id; persistence is the
   * page's responsibility so the answers signal stays the single source of truth.
   *
   * @param {HTMLElement} li
   * @param {QuestionDefinition} q
   */
  _renderCapture(li, q) {
    renderRemediationCapture(this._buildProps(), li, q);
  }

  /**
   * Builds the plain props object consumed by the exported pure render
   * functions above. Not named `_props` — kept as an ordinary private
   * helper reused by `render()` and the tested `_render*` methods.
   *
   * @returns {RemediationSectionProps}
   */
  _buildProps() {
    return {
      catalogue: this.catalogue,
      answers: this.answers,
      attributeFailures: this.attributeFailures,
      client: this.client,
      responsibleParty: this.responsibleParty,
      canAttribute: this.canAttribute,
      remediationFields: this.remediationFields,
      canCaptureDetails: this.canCaptureDetails,
      captureGroups: this.captureGroups,
      canCapture: this.canCapture,
      captureEls: this._captureEls,
      canSelectRemediation: this.canSelectRemediation,
      dispatchCapture: (questionId, fieldKey, value) =>
        this.emit('cora-capture', { questionId, fieldKey, value }),
      dispatchDetail: (questionId, key, value) =>
        this.emit('cora-remediation-detail', { questionId, key, value }),
      dispatchAttribute: (questionId, attributedParty) =>
        this.emit('cora-attribute', { questionId, attributedParty }),
      dispatchRemediationAction: (questionId, action, selected) =>
        this.emit('cora-remediation-action', {
          questionId,
          action,
          selected,
        }),
      dispatchRemediationFreeForm: (questionId, value) =>
        this.emit('cora-remediation-freeform', { questionId, value }),
    };
  }
}

customElements.define('cora-remediation-section', CORARemediationSection);
