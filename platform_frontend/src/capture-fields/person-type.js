// @ts-check
/**
 * The `person` Issue Capture Field type: who a failure is attributed to.
 *
 * A module of its own where the four textual types share one adapter, because
 * it differs in every way they are the same. Its value is an object rather than
 * a string, it is picked from a live directory rather than typed, and its
 * control is two forms — a picker until someone is chosen, then their name plus
 * a way back to nobody.
 *
 * @typedef {import('./contract.js').CaptureFieldType} CaptureFieldType
 */

import { h } from '../lib/html.js';
import { PeoplePicker } from '../components/base/cora-people-picker.js';
import {
  captureDisplayText,
  isEmptyCaptureValue,
  isPerson,
} from '../evaluators/capture-values.js';

/** @type {CaptureFieldType} */
export const PERSON_CAPTURE_FIELD_TYPE = {
  type: 'person',

  // The picker names its own input, and the chosen-person form is text plus a
  // button — neither is a control a caption may wrap.
  caption: 'beside',

  validate(field, value) {
    if (!isPerson(value)) {
      throw new Error(
        `Invalid value for person Issue Capture Field "${field.key}" — expected an account and a display name.`
      );
    }
  },

  /**
   * A people picker until someone is chosen, then their name plus a clear
   * button.
   *
   * The picker alone offers no way back to nobody — its input holds a query,
   * not the chosen person — so without the collapsed form a Reviewer could
   * attribute a failure and never un-attribute it.
   */
  editControl({ field, value, onCapture, peopleSearch, onPersonQuery }) {
    if (!isEmptyCaptureValue(value)) {
      return h(
        'div',
        { className: 'cora-capture-person-selected' },
        h(
          'span',
          { className: 'cora-capture-person-current' },
          captureDisplayText(value)
        ),
        h(
          'button',
          {
            className: 'cora-capture-person-clear',
            type: 'button',
            'aria-label': `Clear ${field.label}`,
            onclick: () => onCapture(field.key, null),
          },
          '✕'
        )
      );
    }

    const search = peopleSearch[field.key] ?? {
      query: '',
      people: [],
      status: 'idle',
    };
    return PeoplePicker({
      placeholder: 'Search people…',
      people: search.people,
      status: search.status,
      inputValue: search.query,
      ariaLabel: `Search people for ${field.label}`,
      onQueryInput: (query) => onPersonQuery(field.key, query),
      onSelect: (person) => onCapture(field.key, person),
    });
  },
};
