// @ts-check

import {
  displayNameFor,
  UnknownCaseTypeError,
} from '../../case-types/manifest.js';

/**
 * Turn an unregistered feed slug into presentation copy without exposing the
 * persisted identifier as visible or accessible text.
 *
 * @param {string} slug
 * @returns {string}
 */
function humanizeUnknownSlug(slug) {
  const words = slug
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
  const label = words.join(' ');
  return label && label !== slug ? label : 'Unknown Case Type';
}

/**
 * Resolve a persisted Case Type slug to the display name used by My Stats.
 *
 * @param {string} slug
 * @returns {string}
 */
export function caseTypeLabelFor(slug) {
  try {
    return displayNameFor(slug);
  } catch (error) {
    if (!(error instanceof UnknownCaseTypeError)) throw error;
    return humanizeUnknownSlug(slug);
  }
}

/**
 * Sort Case Type columns deterministically for every report bucket.
 *
 * @param {{ key: string, label: string }[]} columns
 * @returns {{ key: string, label: string }[]}
 */
export function sortCaseTypeColumns(columns) {
  // Raw comparison keeps the column order stable across browser locales.
  const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
  return [...columns].sort(
    (a, b) => compare(a.label, b.label) || compare(a.key, b.key)
  );
}
