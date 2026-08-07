// @ts-check
import { afterEach, beforeEach } from 'node:test';

export const BROWSER_GLOBAL_NAMES = [
  'window',
  'document',
  'customElements',
  'HTMLElement',
  'HTMLButtonElement',
  'CustomEvent',
  'CSS',
  'location',
  'navigator',
  'crypto',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'confirm',
  'alert',
  'prompt',
  'fetch',
  'setTimeout',
  'clearTimeout',
  '_lastFocused',
];

/** @typedef {{ target: object, descriptors: PropertyDescriptorMap, children: ObjectSnapshot[] }} ObjectSnapshot */
/** @typedef {{ name: string, descriptor?: PropertyDescriptor, object?: ObjectSnapshot }} GlobalSnapshot */

let hooksInstalled = false;
const isolatedNames = new Set();

/** @param {unknown} value */
function isPlainMutableObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return (
    Array.isArray(value) || prototype === Object.prototype || prototype === null
  );
}

/**
 * Snapshot plain stub objects as well as their property descriptors. The
 * recursion catches mutable registries and listener maps without traversing
 * component instances stored on properties such as `document.body`.
 *
 * @param {object} target
 * @param {Set<object>} seen
 * @param {number} depth
 * @returns {ObjectSnapshot}
 */
function snapshotObject(target, seen, depth) {
  seen.add(target);
  const descriptors = Object.getOwnPropertyDescriptors(target);
  /** @type {ObjectSnapshot[]} */
  const children = [];

  if (depth > 0) {
    for (const descriptor of Object.values(descriptors)) {
      if (
        'value' in descriptor &&
        isPlainMutableObject(descriptor.value) &&
        !seen.has(descriptor.value)
      ) {
        children.push(snapshotObject(descriptor.value, seen, depth - 1));
      }
    }
  }

  return { target, descriptors, children };
}

/** @param {ObjectSnapshot} snapshot */
function restoreObject(snapshot) {
  const baselineKeys = new Set(Reflect.ownKeys(snapshot.descriptors));
  for (const key of Reflect.ownKeys(snapshot.target)) {
    if (baselineKeys.has(key)) continue;
    const current = Object.getOwnPropertyDescriptor(snapshot.target, key);
    if (current?.configurable) Reflect.deleteProperty(snapshot.target, key);
  }

  Object.defineProperties(snapshot.target, snapshot.descriptors);
  for (const child of snapshot.children) restoreObject(child);
}

/** @param {string[]} names @returns {GlobalSnapshot[]} */
function snapshotGlobals(names) {
  return names.map((name) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    const value = descriptor && 'value' in descriptor ? descriptor.value : null;
    return {
      name,
      descriptor,
      // A browser's custom-element registry is append-only. Lazy route imports
      // may define elements during a test while the ESM module is then cached;
      // rolling the registry back would remove definitions that cannot be
      // replayed. Restore replacement of the global itself, but retain valid
      // registrations made on the baseline registry object.
      object:
        name !== 'customElements' && isPlainMutableObject(value)
          ? snapshotObject(value, new Set(), 3)
          : undefined,
    };
  });
}

/** @param {GlobalSnapshot[]} snapshots */
function restoreGlobals(snapshots) {
  for (const snapshot of snapshots) {
    if (snapshot.descriptor) {
      Object.defineProperty(globalThis, snapshot.name, snapshot.descriptor);
      if (snapshot.object) restoreObject(snapshot.object);
      continue;
    }

    const current = Object.getOwnPropertyDescriptor(globalThis, snapshot.name);
    if (current?.configurable)
      Reflect.deleteProperty(globalThis, snapshot.name);
  }
}

/**
 * Keep browser-global replacements local to the test that made them.
 *
 * The baseline is captured by `beforeEach`, after a test file has installed
 * its DOM and imported its custom elements. `afterEach` restores both global
 * property descriptors and the mutable plain-object state used by the DOM
 * stubs (for example `location.hash` and document listeners). Custom-element
 * definitions remain append-only, as they are in a browser. This timing
 * preserves deliberate file-level setup while preventing test order from
 * becoming part of the fixture.
 *
 * Call once during a test file's top-level setup. `installDom()` already does
 * this for suites using the shared DOM stub.
 *
 * @param {string[]} [names]
 */
export function isolateBrowserGlobals(names = BROWSER_GLOBAL_NAMES) {
  for (const name of names) isolatedNames.add(name);
  if (hooksInstalled) return;
  hooksInstalled = true;

  /** @type {GlobalSnapshot[][]} */
  const baselines = [];
  beforeEach(() => {
    baselines.push(snapshotGlobals([...isolatedNames]));
  });
  afterEach(() => {
    const baseline = baselines.pop();
    if (baseline) restoreGlobals(baseline);
  });
}
