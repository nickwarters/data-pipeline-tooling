// @ts-check
/**
 * What one Issue Capture Field type knows about itself.
 *
 * The three things that used to be spread across `evaluators/issue-capture.js`,
 * `lib/capture-engine.js` and `components/sections/cora-capture-groups.js` —
 * what a write of this type may hold, what control the Reviewer edits it with,
 * and how a caption names that control.
 *
 * **Reading a stored value is deliberately not here.** How a value displays and
 * whether it counts as nothing are total functions of the value, never of the
 * field's declared type: a Case saved before `person` fields existed holds a
 * plain string under a person key, because the control fell through to a text
 * box then. Only the write path judges what a field may hold; a reader shows
 * what is there. Routing reads through the type would turn those Cases blank.
 *
 * @typedef {import('../sharepoint-client.js').CaptureField} CaptureField
 * @typedef {import('../evaluators/issue-capture.js').CaptureValue} CaptureValue
 */

/**
 * How a caption names this type's control.
 *
 * - `wraps` — one control, so the caption is a `<label>` around it, which
 *   associates the two without an id that would have to stay unique per row.
 * - `legend` — several inputs each already inside their own `<label>`, so the
 *   caption names the set with a `<legend>` in a `<fieldset>`.
 * - `beside` — not a control a caption may wrap at all, so the caption is a
 *   plain span next to it.
 *
 * @typedef {'wraps' | 'legend' | 'beside'} CaptionStyle
 */

/**
 * @typedef {Object} CaptureFieldEditContext
 * @property {CaptureField} field
 * @property {unknown} value The stored value, whatever shape it is in.
 * @property {string} namePrefix Keeps input names unique across rows.
 * @property {(fieldKey: string, value: CaptureValue | null) => void} onCapture
 * @property {Record<string, import('../lib/people-search.js').PeopleSearchState>} peopleSearch
 *   The caller's search state, for a type that searches. This view holds no
 *   state and runs no search of its own.
 * @property {(fieldKey: string, query: string) => void} onPersonQuery
 */

/**
 * @typedef {Object} CaptureFieldType
 * @property {string} type The `CaptureField.type` this answers for.
 * @property {CaptionStyle} caption
 * @property {(field: CaptureField, value: CaptureValue) => void} validate
 *   Throws, naming the field, on a value this type cannot hold. Never asked
 *   about an empty value: clearing a field stays possible whatever a type says.
 * @property {(context: CaptureFieldEditContext) => HTMLElement} editControl
 */

export {};
