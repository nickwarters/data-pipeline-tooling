// @ts-check
import { h } from '../../lib/html.js';
import { EmptyState } from '../../lib/empty-state.js';
import { evaluate } from '../../evaluators/applicability-evaluator.js';
import { isFailure } from '../../evaluators/failure-evaluator.js';
import { anyRemediationRequired } from '../../evaluators/remediation-status.js';
import { PeoplePicker } from '../../components/base/cora-people-picker.js';
import { CaptureGroups } from '../../components/sections/cora-capture-groups.js';

import { normaliseConfiguredActions } from '../../evaluators/configured-outcome.js';

/** @typedef {import('../../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../../sharepoint-client.js').Answer} Answer */
/** @typedef {{ loginName: string, displayName: string }} Party */
/** @typedef {import('../../lib/people-search.js').PeopleSearchState} PeopleSearchState */

/**
 * @typedef {object} RemediationSectionProps
 * @property {QuestionDefinition[]} catalogue
 * @property {Record<string, Answer>} answers
 * @property {Party | null} responsibleParty
 * @property {import('../../sharepoint-client.js').CaptureGroup[]} captureGroups
 * @property {Record<string, Map<string, boolean>>} captureCollapsed
 * @property {Record<string, Record<string, PeopleSearchState>>} captureSearch
 *   Per failed Answer, the open people search of each of its `person` Issue
 *   Capture Fields.
 * @property {PeopleSearchState} responsiblePartySearch
 * @property {boolean} canEditIssues
 *   Whether the viewer may edit what this tab records — the capture fields, the
 *   remediation decision and its actions, and the Responsible Party. One flag,
 *   because they are one permission.
 * @property {(party: Party) => void} dispatchResponsibleParty
 * @property {(query: string) => void} dispatchResponsiblePartySearch
 * @property {(questionId: string, fieldKey: string, value: import('../../evaluators/issue-capture.js').CaptureValue | null) => void} dispatchCapture
 * @property {(questionId: string, fieldKey: string, query: string) => void} dispatchCaptureSearch
 * @property {(questionId: string, groupKey: string, collapsed: boolean) => void} dispatchCaptureToggle
 * @property {(questionId: string, action: { id: string, text: string }, selected: boolean) => void} dispatchRemediationAction
 * @property {(questionId: string, value: string) => void} dispatchRemediationFreeForm
 * @property {(questionId: string, required: 'yes' | 'no') => void} dispatchRemediationRequired
 * @property {string} heading The Section's resolved heading.
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

  const heading = h('h2', {}, props.heading);
  // Hoisted above the no-failures return so the field can appear on either exit.
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
 * to. Nothing else on the Case sets it, so the field lives at the foot of the
 * tab that produces those actions.
 *
 * It is asked for only once some failed Answer says remediation *is* required:
 * with nothing to send there is nobody to send it to, and asking anyway left
 * the completion control disabled against a reason no Reviewer could act on.
 * Withdrawing the last such decision clears the stored Party before Send
 * Actions, so the editable view follows the current Answers rather than a
 * stale recipient.
 *
 * Editable on the same permission as the Remediation Actions above it — the
 * Assigned Reviewer, while the Case is still pre-reportable — because naming
 * the recipient and choosing what is sent to them are one act. Afterwards it
 * reads back as plain text, because the person named is who the sent actions
 * are already addressed to. The picker stays visible even once a Party is
 * chosen — a wrong choice is corrected by choosing again, and there is
 * deliberately no clear button.
 *
 * @param {RemediationSectionProps} props
 * @returns {Node | null}
 */
export function ResponsiblePartyField(props) {
  const current = props.responsibleParty;

  if (!props.canEditIssues) {
    return current
      ? h(
          'p',
          { className: 'cora-responsible-party-value' },
          `Responsible Party: ${current.displayName}`
        )
      : null;
  }

  if (!anyRemediationRequired(props.catalogue, props.answers)) return null;

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
      status: props.responsiblePartySearch.status,
      inputValue: props.responsiblePartySearch.query,
      ariaLabel: 'Search people for Responsible Party',
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
 * everything rendered above the capture fields (question and answer), `after`
 * everything below (Remediation Actions).
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
  if (!props.canEditIssues) {
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
  const editable = props.canEditIssues;
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
  if (!props.canEditIssues) {
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
export function renderRemediationCapture(props, li, q) {
  const capture = props.answers[q.id]?.capture ?? {};
  const collapsed = props.captureCollapsed[q.id] ?? new Map();
  li.append(
    ...CaptureGroups({
      groups: props.captureGroups,
      capture,
      canCapture: props.canEditIssues,
      namePrefix: `${q.id}-`,
      collapsed,
      onToggle: (groupKey, next) =>
        props.dispatchCaptureToggle(q.id, groupKey, next),
      peopleSearch: props.captureSearch[q.id] ?? {},
      onCapture: (fieldKey, value) =>
        props.dispatchCapture(q.id, fieldKey, value),
      onPersonQuery: (fieldKey, query) =>
        props.dispatchCaptureSearch(q.id, fieldKey, query),
    })
  );
}
