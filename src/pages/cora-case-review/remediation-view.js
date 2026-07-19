// @ts-check
import { h } from '../../lib/html.js';
import { EmptyState } from '../../lib/empty-state.js';
import { evaluate } from '../../evaluators/applicability-evaluator.js';
import { isFailure } from '../../evaluators/failure-evaluator.js';
import { buildCaptureControl } from '../../lib/capture-engine.js';
import { AttributeMenu } from '../../components/sections/cora-attribute-menu.js';
import '../../components/sections/cora-capture-groups.js';

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
 * @property {Map<string, import('../../components/sections/cora-capture-groups.js').CORACaptureGroups>} captureEls
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
  const li = h('li', { class: 'cora-remediation-item', key: q.id });
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
 * `answer.remediationActions`); ticking/unticking calls the
 * `dispatchRemediationAction` callback so the page persists the selected subset
 * onto the Answer. When the Question opts into free-form remediation, an extra text
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
 * @returns {import('../../components/sections/cora-capture-groups.js').CORACaptureGroups}
 */
function syncCaptureElement(props, q) {
  let cg = props.captureEls.get(q.id);
  if (!cg) {
    cg =
      /** @type {import('../../components/sections/cora-capture-groups.js').CORACaptureGroups} */ (
        h('cora-capture-groups', {
          'oncora-capture': (/** @type {any} */ ev) => {
            /** @type {any} */ (ev).stopPropagation?.();
            const { fieldKey, value } =
              /** @type {CustomEvent<{ fieldKey: string, value: string }>} */ (
                ev
              ).detail;
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
