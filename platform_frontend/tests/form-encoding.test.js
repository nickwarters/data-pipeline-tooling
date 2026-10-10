// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_FORM_ACTIONS,
  decodeFields,
  decodeText,
  encodeFields,
  encodeText,
  formActionsProblem,
} from '../src/services/form-encoding.js';
import { formColumns } from '../form-types/contract.js';
import { APP_CONFIG } from '../src/app-config.js';

// Capability: a Form's free text is stored unreadable at a glance and read
// back exactly as it was typed, whatever characters it holds.

/** @typedef {import('../form-types/contract.js').FormTypeDefinition} FormTypeDefinition */

/** @param {number} n */
function actions(n) {
  return Array.from({ length: n }, (_, i) => ({
    title: `Action ${i + 1}`,
    dueDate: '2026-10-15',
    status: 'Pending',
    details: '',
  }));
}

/**
 * The Actions column of a definition, or `undefined` when it has none.
 *
 * @param {FormTypeDefinition} definition
 */
function actionsColumn(definition) {
  const section = definition.sections.find((s) => s.sectionType === 'actions');
  return section?.sectionType === 'actions' ? section.itemField : undefined;
}

test('the stored encoding of UTF-8 text is standard base64 of its bytes', () => {
  // Pinned because it is a stored contract: changing it orphans every Form.
  assert.equal(encodeText('Feeling good £ ✅'), 'RmVlbGluZyBnb29kIMKjIOKchQ==');
  assert.equal(
    Buffer.from(String(encodeText('Feeling good £ ✅')), 'base64').toString(
      'utf8'
    ),
    'Feeling good £ ✅'
  );
});

test('text in any script, with emoji, smart quotes and line breaks, round-trips', () => {
  for (const text of [
    'plain ASCII',
    '£50 — café, naïve, Zoë',
    '“Quoted” and ‘quoted’ from Word',
    'Emoji 🙂 and a family 👨‍👩‍👧 in one answer',
    'Line one\r\nLine two\nLine three',
    'Ελληνικά, 日本語, العربية',
    '   leading and trailing spaces   ',
  ]) {
    const stored = encodeText(text);
    assert.notEqual(stored, text, text);
    assert.deepEqual(decodeText(stored), { ok: true, value: text }, text);
  }
});

test('a long answer encodes without overflowing the call stack', () => {
  const text = 'é'.repeat(200_000);
  assert.deepEqual(decodeText(encodeText(text)), { ok: true, value: text });
});

test('empty text is stored as nothing and nothing reads back as empty text', () => {
  for (const empty of ['', null, undefined]) {
    assert.equal(encodeText(empty), null);
    assert.deepEqual(decodeText(empty), { ok: true, value: '' });
  }
});

test('a value that is not this encoding reads back as it is, flagged', () => {
  for (const raw of [
    'typed straight into the list',
    'Done', // valid base64 shape, not UTF-8 underneath
    'abc', // wrong length for base64
    '%%%%',
  ]) {
    assert.deepEqual(decodeText(raw), { ok: false, value: raw }, raw);
  }
});

test('Form Actions must be a list of at most the shared limit, each with four text keys', () => {
  assert.equal(formActionsProblem(actions(MAX_FORM_ACTIONS)), null);
  assert.equal(formActionsProblem([]), null);
  assert.match(
    String(formActionsProblem(actions(MAX_FORM_ACTIONS + 1))),
    /more than/
  );
  assert.match(String(formActionsProblem({})), /not a list/);
  assert.match(String(formActionsProblem(['x'])), /not an object/);
  assert.match(String(formActionsProblem([[]])), /not an object/);
  for (const key of ['title', 'dueDate', 'status', 'details']) {
    const [action] = actions(1);
    const missing = { ...action, [key]: undefined };
    assert.match(
      String(formActionsProblem([missing])),
      new RegExp(`\`${key}\``),
      key
    );
  }
});

for (const definition of APP_CONFIG.formTypes) {
  const { plain, encoded } = formColumns(definition);
  const actionsAt = actionsColumn(definition);
  const textColumns = encoded.filter((column) => column !== actionsAt);

  test(`${definition.formName}: a write encodes the encoded columns and passes plain ones through`, () => {
    /** @type {Record<string, unknown>} */
    const fields = {};
    for (const column of plain) fields[column] = `plain ${column}`;
    for (const column of textColumns) fields[column] = `Answer to ${column} £`;
    if (actionsAt) fields[actionsAt] = actions(2);

    const stored = encodeFields(definition, fields);

    for (const column of plain) assert.equal(stored[column], fields[column]);
    for (const column of textColumns) {
      assert.equal(stored[column], encodeText(String(fields[column])), column);
    }
    if (actionsAt) {
      assert.equal(
        stored[actionsAt],
        encodeText(JSON.stringify(fields[actionsAt]))
      );
    }
    assert.deepEqual(decodeFields(definition, stored), {
      fields,
      problems: [],
    });
  });

  test(`${definition.formName}: a write names only the columns it changes`, () => {
    const [column] = textColumns;
    assert.deepEqual(Object.keys(encodeFields(definition, { [column]: 'x' })), [
      column,
    ]);
  });

  test(`${definition.formName}: cleared text and cleared Actions are stored as nothing`, () => {
    /** @type {Record<string, unknown>} */
    const cleared = {};
    for (const column of textColumns) cleared[column] = '';
    if (actionsAt) cleared[actionsAt] = [];
    const stored = encodeFields(definition, cleared);
    for (const column of encoded) assert.equal(stored[column], null, column);

    const read = decodeFields(definition, stored);
    for (const column of textColumns) assert.equal(read.fields[column], '');
    if (actionsAt) assert.deepEqual(read.fields[actionsAt], []);
    assert.deepEqual(read.problems, []);
  });

  if (actionsAt) {
    test(`${definition.formName}: a write holding too many Form Actions is refused, not stored`, () => {
      assert.throws(
        () =>
          encodeFields(definition, {
            [actionsAt]: actions(MAX_FORM_ACTIONS + 1),
          }),
        new RegExp(`${actionsAt} column holds`)
      );
    });

    test(`${definition.formName}: Form Actions read back with only their four keys`, () => {
      const [action] = actions(1);
      const stored = {
        [actionsAt]: encodeText(JSON.stringify([{ ...action, extra: 'x' }])),
      };
      assert.deepEqual(decodeFields(definition, stored).fields[actionsAt], [
        action,
      ]);
    });

    test(`${definition.formName}: unreadable Form Actions read back as none, each reported`, () => {
      const cases = [
        ['not encoded at all', /is not encoded/],
        [encodeText('{not json'), /is not JSON/],
        [
          encodeText(JSON.stringify(actions(MAX_FORM_ACTIONS + 1))),
          /more than/,
        ],
        [encodeText('"a string"'), /not a list/],
      ];
      for (const [stored, problem] of cases) {
        const read = decodeFields(definition, { [actionsAt]: stored });
        assert.deepEqual(read.fields[actionsAt], [], String(stored));
        assert.equal(read.problems.length, 1, String(stored));
        assert.equal(read.problems[0].column, actionsAt);
        assert.match(read.problems[0].problem, /** @type {RegExp} */ (problem));
      }
    });
  }

  test(`${definition.formName}: one hand-edited column is reported and the rest still read`, () => {
    const [bad, good] = textColumns;
    const read = decodeFields(definition, {
      [bad]: 'typed into the list',
      [good]: encodeText('fine'),
    });
    assert.equal(read.fields[bad], 'typed into the list');
    assert.equal(read.fields[good], 'fine');
    assert.deepEqual(read.problems, [
      { column: bad, problem: 'is not encoded', raw: 'typed into the list' },
    ]);
  });
}
