// @ts-check
import { defineView } from '../lib/view.js';
import { h } from '../lib/html.js';
import {
  activeSlug,
  commit,
  currentBank,
} from '../question-bank/question-bank-store.js';

/** Colour a freshly-created label gets until the curator edits it. */
export const DEFAULT_LABEL_COLOR = '#2563eb';

/**
 * Derive a stable, unique label id from a display name. Slugifies the name and
 * disambiguates against `existingIds` with a numeric suffix.
 *
 * @param {string} name
 * @param {string[]} existingIds
 * @returns {string}
 */
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
 * Reporting-label editor for a single Question Definition (ADR-0015).
 *
 * Labels are a bank-side concept: they are assigned here and rendered as colour
 * pills, but they never travel to a Case and have no effect on how a question is
 * presented to a Reviewer. Reads the active bank's label set
 * (`currentBank().labels`), lets the curator assign/unassign labels on the
 * question, recolour a label inline (the colour is shared across every question
 * carrying it), and mint a brand-new label.
 *
 * @param {{ question: any }} props
 * @returns {Node | undefined}
 */
export function QuestionLabels({ question: q }) {
  if (!q) return undefined;

  const bank = currentBank.get();
  const labels = bank?.labels ?? [];
  const assignedIds = q.labelIds ?? [];
  /** @type {Record<string, import('../../dev/fixtures/question-banks.js').Label>} */
  const byId = Object.fromEntries(
    labels.map((/** @type {any} */ l) => [l.id, l])
  );

  const pills = assignedIds
    .map((/** @type {string} */ id) => byId[id])
    .filter(Boolean)
    .map((/** @type {any} */ label) => pill(q, label));

  const pillRow = h(
    'div',
    { class: 'label-row' },
    ...pills,
    pills.length === 0 &&
      h('span', { class: 'label-empty' }, 'No labels assigned')
  );

  const unassigned = labels.filter(
    (/** @type {any} */ l) => !assignedIds.includes(l.id)
  );
  const addRow = h(
    'div',
    { class: 'label-add-row' },
    ...unassigned.map((/** @type {any} */ l) =>
      h(
        'button',
        {
          class: 'label-add-chip',
          style: `--pill: ${l.color};`,
          onclick: () =>
            commit(() => {
              (q.labelIds ||= []).push(l.id);
            }),
        },
        h('span', { class: 'label-swatch-dot' }),
        h('span', {}, l.name)
      )
    ),
    createControl(q)
  );

  return h(
    'div',
    { class: 'labels-block' },
    h('label', { class: 'options-label' }, 'Labels'),
    h(
      'div',
      { class: 'labels-help' },
      'Reporting tags — shown here only; they never appear on a Case.'
    ),
    pillRow,
    addRow
  );
}

/**
 * @param {any} q
 * @param {import('../../dev/fixtures/question-banks.js').Label} label
 */
function pill(q, label) {
  const color = /** @type {any} */ (
    h('input', {
      type: 'color',
      class: 'label-pill-color',
      value: label.color,
      title: 'Edit colour',
    })
  );
  color.addEventListener('change', (/** @type {any} */ e) =>
    recolour(label.id, e.target.value)
  );

  return h(
    'span',
    { class: 'label-pill', style: `--pill: ${label.color};` },
    color,
    h('span', { class: 'label-pill-name' }, label.name),
    h(
      'span',
      {
        class: 'label-pill-x',
        title: 'Remove label',
        onclick: () =>
          commit(() => {
            q.labelIds = (q.labelIds ?? []).filter(
              (/** @type {string} */ id) => id !== label.id
            );
            if (q.labelIds.length === 0) delete q.labelIds;
          }),
      },
      '×'
    )
  );
}

/** @param {any} q */
function createControl(q) {
  const name = /** @type {any} */ (
    h('input', { class: 'label-new-name', placeholder: 'New label…' })
  );
  const color = /** @type {any} */ (
    h('input', {
      type: 'color',
      class: 'label-new-color',
      value: DEFAULT_LABEL_COLOR,
      title: 'Pick colour',
    })
  );
  const add = h(
    'button',
    {
      class: 'label-new-add',
      onclick: () => {
        const text = String(name.value).trim();
        if (!text) return;
        const chosen = color.value || DEFAULT_LABEL_COLOR;
        commit((types) => {
          const b = types[activeSlug.get()];
          b.labels ||= [];
          const id = makeLabelId(
            text,
            b.labels.map((/** @type {any} */ l) => l.id)
          );
          b.labels.push({ id, name: text, color: chosen });
          (q.labelIds ||= []).push(id);
        });
      },
    },
    '+ new label'
  );
  return h('span', { class: 'label-new' }, name, color, add);
}

/**
 * @param {string} id
 * @param {string} color
 */
function recolour(id, color) {
  commit((types) => {
    const b = types[activeSlug.get()];
    const l = (b.labels ?? []).find((/** @type {any} */ x) => x.id === id);
    if (l) l.color = color;
  });
}

export const CORAQuestionLabels = defineView('cora-question-labels', {
  props: /** @type {{ question: any }} */ ({ question: null }),
  render({ props }) {
    return QuestionLabels({ question: props.question });
  },
});
