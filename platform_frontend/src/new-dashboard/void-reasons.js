// @ts-check

export const VOID_REASONS = Object.freeze([
  Object.freeze({ key: 'duplicate', label: 'Duplicate of another Case' }),
  Object.freeze({ key: 'raised-in-error', label: 'Raised in error' }),
  Object.freeze({ key: 'out-of-scope', label: 'Out of scope for review' }),
  Object.freeze({ key: 'no-evidence', label: 'Evidence unavailable' }),
  Object.freeze({ key: 'superseded', label: 'Superseded by another Case' }),
  Object.freeze({ key: 'withdrawn', label: 'Withdrawn by the business' }),
]);

/** @param {{voidReasons?:string[]}} config */
export function voidReasonsFor(config) {
  if (!config.voidReasons) return VOID_REASONS;
  return VOID_REASONS.filter((reason) =>
    config.voidReasons?.includes(reason.key)
  );
}
