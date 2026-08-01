// @ts-check
import { h } from '../../lib/html.js';
import { EmptyState } from '../../lib/empty-state.js';
import { evaluate } from '../../evaluators/applicability-evaluator.js';
import { isFailure } from '../../evaluators/failure-evaluator.js';
import { buildCaptureControl } from '../../lib/capture-engine.js';
import { AttributeMenu } from '../../components/sections/cora-attribute-menu.js';
import { PeoplePicker } from '../../components/base/cora-people-picker.js';
import { CaptureGroups } from '../../components/sections/cora-capture-groups.js';

import { normaliseConfiguredActions } from '../../evaluators/configured-outcome.js';

/** @typedef {import('../../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../../sharepoint-client.js').Answer} Answer */
/** @typedef {{ loginName: string, displayName: string }} Party */

/**
 * @typedef {object} RemediationSectionProps
 * @property {QuestionDefinition[]} catalogue
 * @property {Record<string, Answer>} answers
 * @property {boolean} attributeFailures
 * @property {Party | null} responsibleParty
 * @property {boolean} canAttribute
 * @property {import('../../sharepoint-client.js').RemediationField[]} remediationFields
 * @property {boolean} canCaptureDetails
 * @property {import('../../sharepoint-client.js').CaptureGroup[]} captureGroups
 * @property {boolean} canCapture
 * @property {Record<string, Map<string, boolean>>} captureCollapsed
 * @property {Record<string, { query: string, people: import('../../sharepoint-client.js').PersonResult[] }>} attributionSearch
 * @property {{ query: string, people: import('../../sharepoint-client.js').PersonResult[] }} responsiblePartySearch
 * @property {boolean} canSelectRemediation
 * @property {(party: Party) => void} dispatchResponsibleParty
 * @property {(query: string) => void} dispatchResponsiblePartySearch
 * @property {(questionId: string, fieldKey: string, value: string) => void} dispatchCapture
 * @property {(questionId: string, groupKey: string, collapsed: boolean) => void} dispatchCaptureToggle
 * @property {(questionId: string, key: string, value: string) => void} dispatchDetail
 * @property {(questionId: string, attributedParty: Party | null) => void} dispatchAttribute
 * @property {(questionId: string, query: string) => void} dispatchAttributeSearch
 * @property {(questionId: string, action: { id: string, text: string }, selected: boolean) => void} dispatchRemediationAction
 * @property {(questionId: string, value: string) => void} dispatchRemediationFreeForm
 * @property {(questionId: string, required: 'yes' | 'no') => void} dispatchRemediationRequired
 */

/**
 * The Applicable Questions whose Answers currently fail, in catalogue order.
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
  // Case-level, so it belongs to the tab rather than to any failure — and it is
  // computed once for both exits, because a Case with no failures still needs
  // someone named before its actions can be sent.
  const responsibleParty = ResponsiblePartyField(props);
  const tail = responsibleParty ? [responsibleParty] : [];

  if (failed.length === 0) {
    const empty = EmptyState('No failures.', {
      className: 'cora-remediation-empty',
    });
    return [heading, empty, ...tail];
  }

  const list = h('ul', { className: 'cora-remediation-list' });
  for (const q of failed) {
    list.appendChild(renderRemediationItem(props, q));
  }
  return [heading, list, ...tail];
}

/**
 * The Case-level **Responsible Party**: who the Remediation Actions are sent
 * to. Nothing else on the Case sets it, and until it is set the completion
 * control is shown disabled with a reason naming this field, so the field lives
 * at the foot of the tab that produces those actions.
 *
 * Editable on the same permission as the Remediation Actions above it — the
 * Assigned Reviewer, while the Case is still pre-reportable — because naming
 * the recipient and choosing what is sent to them are one act. Afterwards it
 * reads back as plain text, because the person named is who the sent actions
 * are already addressed to. The picker stays visible even once a Party is chosen — a wrong
 * choice is corrected by choosing again. There is deliberately no clear button:
 * an empty value only ever re-blocks completion, and a SharePoint person column
 * is not emptied by writing an empty string in any case.
 *
 * @param {RemediationSectionProps} props
 * @returns {Node | null}
 */
export function ResponsiblePartyField(props) {
  const current = props.responsibleParty;

  if (!props.canSelectRemediation) {
    return current
      ? h(
          'p',
          { className: 'cora-responsible-party-value' },
          `Responsible Party: ${current.displayName}`
        )
      : null;
  }

  /** @type {Node[]} */
  const children = [
    // A `p`, not a `label`: `PeoplePicker` exposes no input id to point at, and
    // the picker carries its own accessible name.
    h(
      'p',
      { className: 'cora-responsible-party-label' },
      'Responsible Party (who these actions are sent to)'
    ),
  ];
  if (current) {
    children.push(
      h(
        'span',
        { className: 'cora-responsible-party-current' },
        current.displayName
      )
    );
  }
  children.push(
    PeoplePicker({
      placeholder: 'Search people…',
      people: props.responsiblePartySearch.people,
      query: props.responsiblePartySearch.query,
      inputValue: props.responsiblePartySearch.query,
      ariaLabel: 'Search people for Responsible Party',
      // This value resolves a Role and gates completion, and the field is
      // read-only once the actions are sent, so a mistyped account would be
      // unrecoverable from here.
      allowRawAccount: false,
      onQueryInput: (query) => props.dispatchResponsiblePartySearch(query),
      onSelect: (party) => props.dispatchResponsibleParty(party),
    })
  );

  return h('div', { className: 'cora-responsible-party-field' }, ...children);
}

/**
 * @param {RemediationSectionProps} props
 * @param {QuestionDefinition} q
 * @returns {HTMLElement}
 */
export function renderRemediationItem(props, q) {
  const li = h('li', { className: 'cora-remediation-item', key: q.id });
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
 * everything rendered above the capture fields (question, answer,
 * attribution, details), `after` everything below (Remediation Actions).
 *
 * @param {RemediationSectionProps} props
 * @param {QuestionDefinition} q
 * @returns {{ before: Node[], after: Node[] }}
 */
function buildItemContent(props, q) {
  const before = h('div', {});
  if (q.questionGroup) {
    before.appendChild(
      h('p', { className: 'cora-remediation-group' }, q.questionGroup)
    );
  }
  before.appendChild(
    h('p', { className: 'cora-remediation-question' }, q.text)
  );

  const v = props.answers[q.id]?.value;
  const ansText = `Answer: ${Array.isArray(v) ? v.join(', ') : (v ?? '')}`;
  before.appendChild(h('p', { className: 'cora-remediation-answer' }, ansText));

  if (props.attributeFailures) {
    renderRemediationAttribution(props, before, q);
  }
  if (props.remediationFields?.length) {
    renderRemediationDetails(props, before, q);
  }

  const after = h('div', {});
  const remediationRequired = props.answers[q.id]?.remediationRequired;
  renderRemediationRequired(props, after, q, remediationRequired);
  // The decision comes before the remediation: nothing to record against a
  // failure the Reviewer has said needs none, and nothing to record yet on one
  // they have not decided.
  if (remediationRequired === 'yes') {
    renderRemediationActions(props, after, q);
  }

  return { before: [...before.childNodes], after: [...after.childNodes] };
}

/**
 * Renders the **Remediation Required** decision for a failed item: the Reviewer
 * says, per failure, whether remediation is needed, so that "none is needed" is
 * a recorded answer rather than an empty action list nobody has looked at. The
 * radios are per-Question — a shared `name` would collapse every failure on the
 * tab into one group — and cannot be returned to unanswered once chosen.
 *
 * A read-only viewer sees a line only for **No**: that is the one decision with
 * no other visible trace, since a **Yes** is already evidenced by the actions
 * rendered beneath it, and an undecided failure has nothing to show.
 *
 * @param {RemediationSectionProps} props
 * @param {HTMLElement} li
 * @param {QuestionDefinition} q
 * @param {'yes' | 'no' | undefined} current The decision on this Answer, if any.
 */
function renderRemediationRequired(props, li, q, current) {
  if (!props.canSelectRemediation) {
    if (current === 'no') {
      li.appendChild(
        h(
          'p',
          { className: 'cora-remediation-required-value' },
          'Remediation required: No'
        )
      );
    }
    return;
  }

  // A fieldset with a legend, the same shape the Question cards use: the two
  // radios are announced as one named group rather than as two unlabelled
  // options.
  const wrap = h(
    'fieldset',
    { className: 'cora-remediation-required', role: 'radiogroup' },
    h(
      'legend',
      { className: 'cora-remediation-required-label' },
      'Is remediation required?'
    )
  );

  for (const required of /** @type {Array<'yes' | 'no'>} */ (['yes', 'no'])) {
    wrap.appendChild(
      h(
        'label',
        { className: 'cora-remediation-required-option' },
        h('input', {
          type: 'radio',
          className: 'cora-remediation-required-radio',
          name: `${q.id}-remediation-required`,
          value: required,
          checked: current === required,
          onchange: () => props.dispatchRemediationRequired(q.id, required),
        }),
        h('span', {}, required === 'yes' ? 'Yes' : 'No')
      )
    );
  }

  li.appendChild(wrap);
}

/**
 * Renders the reviewer-selectable **Remediation Actions** for a failed item.
 * Each configured action is an independent checkbox, unticked unless the
 * reviewer has already selected it (i.e. its id is present on
 * `answer.remediationActions`); ticking/unticking calls the
 * `dispatchRemediationAction` callback so the page persists the selected subset
 * onto the Answer. Every failed Question also gets a free-form text input for
 * the reviewer's own action, unless its Question Definition withholds one.
 * Read-only viewers see only the selected canned actions and any captured
 * free-form text, both as plain text.
 *
 * @param {RemediationSectionProps} props
 * @param {HTMLElement} li
 * @param {QuestionDefinition} q
 */
function renderRemediationActions(props, li, q) {
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
        { className: 'cora-remediation-actions-heading' },
        'Remediation Actions'
      )
    );
    const actions = h('ul', { className: 'cora-remediation-actions' });
    for (const action of visible) {
      actions.appendChild(
        editable
          ? renderRemediationActionCheckbox(
              props,
              q,
              action,
              selectedIds.has(action.id)
            )
          : h('li', { className: 'cora-remediation-action' }, action.text)
      );
    }
    li.appendChild(actions);
  }

  if (!q.disallowFreeFormRemediation) {
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
    { className: 'cora-remediation-action' },
    h(
      'label',
      {},
      h('input', {
        type: 'checkbox',
        className: 'cora-remediation-action-checkbox',
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
        h('p', { className: 'cora-remediation-freeform-value' }, value)
      );
    }
    return;
  }

  li.appendChild(
    h(
      'div',
      { className: 'cora-remediation-freeform' },
      h(
        'label',
        { className: 'cora-remediation-freeform-label' },
        'Free-form action'
      ),
      h('textarea', {
        className: 'cora-remediation-freeform-input',
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
          { className: 'cora-remediation-attributed-party' },
          `Attributed to: ${attributedParty.displayName}`
        )
      );
    }
    return;
  }

  const menu = AttributeMenu({
    responsibleParty: props.responsibleParty,
    attributedParty: attributedParty ?? null,
    query: props.attributionSearch[q.id]?.query ?? '',
    people: props.attributionSearch[q.id]?.people ?? [],
    onQueryInput: (query) => props.dispatchAttributeSearch(q.id, query),
    onSelect: (/** @type {Party} */ party) => {
      props.dispatchAttribute(q.id, party);
    },
    onClear: () => props.dispatchAttribute(q.id, null),
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
          { className: 'cora-remediation-detail-value' },
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
      { className: 'cora-remediation-detail-field' },
      h('label', { className: 'cora-remediation-detail-label' }, field.label),
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
  const capture = props.answers[q.id]?.capture ?? {};
  const collapsed = props.captureCollapsed[q.id] ?? new Map();
  li.append(
    ...CaptureGroups({
      groups: props.captureGroups,
      capture,
      canCapture: props.canCapture,
      namePrefix: `${q.id}-`,
      collapsed,
      onToggle: (groupKey, next) =>
        props.dispatchCaptureToggle(q.id, groupKey, next),
      onCapture: (fieldKey, value) =>
        props.dispatchCapture(q.id, fieldKey, value),
    })
  );
}
