// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateNotes } from '../src/pages/cora-case-review/summary-notes-appeal-controller.js';

test('legacy Notes bridge is inert without a panel or loaded Case config', () => {
  const base = {
    viewModel: {
      caseRow: null,
      config: null,
      access: { notes: 'hidden' },
    },
    nodes: { notes: null },
    displayMode: (/** @type {any} */ mode) => mode,
  };

  assert.doesNotThrow(() => updateNotes(/** @type {any} */ (base)));
  assert.doesNotThrow(() =>
    updateNotes(
      /** @type {any} */ ({
        ...base,
        nodes: { notes: {} },
      })
    )
  );
  assert.doesNotThrow(() =>
    updateNotes(
      /** @type {any} */ ({
        ...base,
        viewModel: { ...base.viewModel, caseRow: { id: 'c1' } },
        nodes: { notes: {} },
      })
    )
  );
});

test('legacy Notes bridge resolves default headings when the snapshot has none', () => {
  const notes = {};
  updateNotes(
    /** @type {any} */ ({
      viewModel: {
        caseRow: { id: 'c1' },
        config: {},
        access: { notes: 'read-only' },
        saveQueue: {},
      },
      nodes: { notes },
      displayMode: (/** @type {any} */ mode) => mode,
    })
  );

  assert.equal(/** @type {any} */ (notes).heading, 'Notes');
  assert.deepEqual(/** @type {any} */ (notes).placeholders, {});
});
