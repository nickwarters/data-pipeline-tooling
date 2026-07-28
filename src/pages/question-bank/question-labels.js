// @ts-check
import { h } from '../../lib/html.js';
import { EmptyState } from '../../lib/empty-state.js';

const DEFAULT_LABEL_COLOR = '#2563eb';

/** @param {string} name @param {string[]} existingIds */
export function makeLabelId(name, existingIds) {
  const base =
    'lbl-' +
    (String(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'label');
  let id = base;
  let n = 2;
  while (existingIds.includes(id)) id = `${base}-${n++}`;
  return id;
}

/**
 * Pure reporting-label editor for one Question Definition.
 * @param {{ question: any, bank: any, dispatch: (action: any) => void }} props
 */
export function QuestionLabels({ question: q, bank, dispatch }) {
  if (!q) return undefined;
  const labels = bank?.labels ?? [];
  const assignedIds = q.labelIds ?? [];
  const byId = Object.fromEntries(
    labels.map((/** @type {any} */ label) => [label.id, label])
  );
  const pills = assignedIds
    .map((/** @type {string} */ id) => byId[id])
    .filter(Boolean)
    .map((/** @type {any} */ label) => labelPill(q.id, label, dispatch));

  const unassigned = labels.filter(
    (/** @type {any} */ label) => !assignedIds.includes(label.id)
  );
  return h(
    'div',
    { className: 'labels-block' },
    h('label', { className: 'options-label' }, 'Labels'),
    h(
      'div',
      { className: 'labels-help' },
      'Reporting tags — shown here only; they never appear on a Case.'
    ),
    h(
      'div',
      { className: 'label-row' },
      ...pills,
      pills.length === 0
        ? EmptyState('No labels assigned', {
            tag: 'span',
            className: 'label-empty',
          })
        : null
    ),
    h(
      'div',
      { className: 'label-add-row' },
      ...unassigned.map((/** @type {any} */ label) =>
        h(
          'button',
          {
            className: 'label-add-chip',
            style: `--pill: ${label.color};`,
            onclick: () =>
              dispatch({
                type: 'question/label-assigned',
                questionId: q.id,
                labelId: label.id,
              }),
          },
          h('span', { className: 'label-swatch-dot' }),
          h('span', {}, label.name)
        )
      ),
      createLabelControl(q.id, bank, dispatch)
    )
  );
}

/** @param {string} questionId @param {any} label @param {(action: any) => void} dispatch */
function labelPill(questionId, label, dispatch) {
  return h(
    'span',
    { className: 'label-pill', style: `--pill: ${label.color};` },
    h('input', {
      type: 'color',
      className: 'label-pill-color',
      value: label.color,
      title: 'Edit colour',
      onchange: (/** @type {any} */ event) =>
        dispatch({
          type: 'label/colour-changed',
          labelId: label.id,
          colour: event.target.value,
        }),
    }),
    h('span', { className: 'label-pill-name' }, label.name),
    h(
      'button',
      {
        className: 'label-pill-x',
        title: 'Remove label',
        onclick: () =>
          dispatch({
            type: 'question/label-unassigned',
            questionId,
            labelId: label.id,
          }),
      },
      '×'
    )
  );
}

/** @param {string} questionId @param {any} bank @param {(action: any) => void} dispatch */
function createLabelControl(questionId, bank, dispatch) {
  const name = /** @type {any} */ (
    h('input', { className: 'label-new-name', placeholder: 'New label…' })
  );
  const color = /** @type {any} */ (
    h('input', {
      type: 'color',
      className: 'label-new-color',
      value: DEFAULT_LABEL_COLOR,
      title: 'Pick colour',
    })
  );
  return h(
    'span',
    { className: 'label-new' },
    name,
    color,
    h(
      'button',
      {
        className: 'label-new-add',
        onclick: () => {
          const text = String(name.value).trim();
          if (!text) return;
          dispatch({
            type: 'label/created',
            questionId,
            label: {
              id: makeLabelId(
                text,
                (bank.labels ?? []).map((/** @type {any} */ label) => label.id)
              ),
              name: text,
              color: color.value || DEFAULT_LABEL_COLOR,
            },
          });
        },
      },
      '+ new label'
    )
  );
}
