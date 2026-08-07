// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';

installDom();

// DOM stubs must be in place before any src import

const { buildCaptureControl } = await import('../src/lib/capture-engine.js');

const noop = () => {};

test('buildCaptureControl: textarea carries its configured placeholder', () => {
  const control = /** @type {any} */ (
    buildCaptureControl(
      {
        key: 'impact',
        label: 'Impact',
        type: 'textarea',
        placeholder: 'Describe the customer impact…',
      },
      '',
      noop
    )
  );

  assert.equal(control.placeholder, 'Describe the customer impact…');
});

test('buildCaptureControl: text input carries its configured placeholder', () => {
  const control = /** @type {any} */ (
    buildCaptureControl(
      {
        key: 'ref',
        label: 'Reference',
        type: 'text',
        placeholder: 'e.g. CMP-1234',
      },
      '',
      noop
    )
  );

  assert.equal(control.placeholder, 'e.g. CMP-1234');
});

test('buildCaptureControl: no configured placeholder leaves the control blank', () => {
  const textarea = /** @type {any} */ (
    buildCaptureControl({ key: 'a', label: 'A', type: 'textarea' }, '', noop)
  );
  const input = /** @type {any} */ (
    buildCaptureControl({ key: 'b', label: 'B', type: 'text' }, '', noop)
  );

  assert.equal(textarea.getAttribute('placeholder'), null);
  assert.equal(input.getAttribute('placeholder'), null);
});

test('buildCaptureControl: placeholder is ignored on choice controls', () => {
  const select = /** @type {any} */ (
    buildCaptureControl(
      {
        key: 'cat',
        label: 'Category',
        type: 'select',
        options: ['A'],
        placeholder: 'nope',
      },
      '',
      noop
    )
  );
  const radio = /** @type {any} */ (
    buildCaptureControl(
      {
        key: 'sev',
        label: 'Severity',
        type: 'radio',
        options: ['Low'],
        placeholder: 'nope',
      },
      '',
      noop
    )
  );

  assert.equal(select.getAttribute('placeholder'), null);
  assert.equal(radio.getAttribute('placeholder'), null);
});
