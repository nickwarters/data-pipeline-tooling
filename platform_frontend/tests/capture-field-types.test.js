// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './_dom-stub.js';
import {
  captureFieldTypeNames,
  getCaptureFieldType,
  registerCaptureFieldType,
} from '../src/capture-fields/registry.js';
import {
  captureDisplayText,
  isEmptyCaptureValue,
} from '../src/evaluators/capture-values.js';

installDom();

// Capability: an Issue Capture Field type says what a write may hold and what
// control edits it, in one module, instead of three files branching on the
// type name.

/** @param {any} overrides @returns {any} */
function field(overrides = {}) {
  return { key: 'rootCause', label: 'Root cause', type: 'text', ...overrides };
}

// --- The four primitives ---

test('the built-in types are the four that hold text', () => {
  assert.deepEqual(captureFieldTypeNames().sort(), [
    'radio',
    'select',
    'text',
    'textarea',
  ]);
});

test('a free-text type takes text and refuses anything else', () => {
  for (const type of ['text', 'textarea']) {
    const plugin = /** @type {any} */ (getCaptureFieldType(type));
    assert.doesNotThrow(() => plugin.validate(field({ type }), 'written'));
    assert.throws(
      () =>
        plugin.validate(field({ type }), { loginName: 'a', displayName: 'A' }),
      new RegExp(`Invalid value for ${type} Issue Capture Field "rootCause"`)
    );
  }
});

test('a choice type takes only what its field offers, and says which value it refused', () => {
  for (const type of ['select', 'radio']) {
    const plugin = /** @type {any} */ (getCaptureFieldType(type));
    const declared = field({ type, options: ['Process', 'Training'] });

    assert.doesNotThrow(() => plugin.validate(declared, 'Training'));
    assert.throws(
      () => plugin.validate(declared, 'Something else'),
      /Invalid value "Something else" for (select|radio) Issue Capture Field "rootCause"/
    );
    // A field declaring no options offers nothing, so nothing is valid.
    assert.throws(
      () => plugin.validate(field({ type }), 'Training'),
      /Invalid value/
    );
  }
});

test('a caption names one control by wrapping it, and a radio set by a legend', () => {
  // Several inputs each already inside their own label cannot be wrapped by one
  // more; the rest can, which associates the two without an id that would have
  // to stay unique across rows.
  assert.equal(getCaptureFieldType('text')?.caption, 'wraps');
  assert.equal(getCaptureFieldType('textarea')?.caption, 'wraps');
  assert.equal(getCaptureFieldType('select')?.caption, 'wraps');
  assert.equal(getCaptureFieldType('radio')?.caption, 'legend');
});

test('a type builds its own control, and reports edits under its field key', () => {
  /** @type {any[]} */
  const edits = [];
  const control = /** @type {any} */ (
    getCaptureFieldType('text')?.editControl(
      /** @type {any} */ ({
        field: field(),
        value: 'already written',
        namePrefix: 'row-1-',
        onCapture: (/** @type {any} */ ...args) => edits.push(args),
      })
    )
  );

  assert.equal(control.value, 'already written');
  control.value = 'changed';
  control._listeners.change?.[0]({ target: control, currentTarget: control });
  assert.deepEqual(edits, [['rootCause', 'changed']]);
});

// --- Reading a stored value is not the type's business ---

test('emptiness and display text are read off the value, never the field type', () => {
  // A Case saved before `person` fields existed holds a plain string under a
  // person key, because the control fell through to a text box then. Routing
  // reads through the declared type would turn those Cases blank.
  assert.equal(
    captureDisplayText('typed before person fields'),
    'typed before person fields'
  );
  assert.equal(isEmptyCaptureValue('typed before person fields'), false);

  assert.equal(
    captureDisplayText({
      loginName: 'corp\\jsmith',
      displayName: 'Jane Smith',
    }),
    'Jane Smith'
  );
  for (const nothing of [null, undefined, '']) {
    assert.equal(isEmptyCaptureValue(nothing), true);
  }
  // A half-filled person is something, not nothing — so a write of one is
  // refused rather than silently clearing the field.
  assert.equal(isEmptyCaptureValue({ loginName: 'corp\\jsmith' }), false);
  assert.equal(captureDisplayText({ loginName: 'corp\\jsmith' }), '');
});

// --- Registration ---

test('a registered type answers for its name, and replaces one of the same name', () => {
  const original = getCaptureFieldType('text');
  const substitute = /** @type {any} */ ({
    type: 'text',
    caption: 'beside',
    validate: () => {},
    editControl: () => null,
  });
  try {
    registerCaptureFieldType(substitute);
    assert.equal(getCaptureFieldType('text'), substitute);
  } finally {
    registerCaptureFieldType(/** @type {any} */ (original));
  }
  assert.equal(getCaptureFieldType('text'), original);
});

test('registering something with no type name throws', () => {
  assert.throws(
    () => registerCaptureFieldType(/** @type {any} */ ({ validate: () => {} })),
    /requires a type name/
  );
});

test('an unknown type is undefined rather than a throw', () => {
  // A Case Type declaring one is caught by the verify gate before a browser
  // sees it; a reader that meets one at runtime shows what is stored rather
  // than taking the page down.
  assert.equal(getCaptureFieldType('nosuchtype'), undefined);
});
