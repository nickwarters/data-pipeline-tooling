// @ts-check

/**
 * @template T
 * @typedef {{ get: () => T, set: (v: T) => void }} Signal
 */

/**
 * @template T
 * @typedef {{ get: () => T }} ComputedSignal
 */

/** @type {(() => void)|null} */
let currentEffect = null;

/**
 * @template T
 * @param {T} initialValue
 * @returns {Signal<T>}
 */
export function signal(initialValue) {
  let value = initialValue;
  /** @type {Set<() => void>} */
  const subscribers = new Set();

  return {
    get() {
      if (currentEffect) subscribers.add(currentEffect);
      return value;
    },
    set(newValue) {
      value = newValue;
      for (const sub of [...subscribers]) sub();
    },
  };
}

/**
 * @template T
 * @param {() => T} fn
 * @returns {ComputedSignal<T>}
 */
export function computed(fn) {
  /** @type {T} */
  let cachedValue = /** @type {T} */ (/** @type {unknown} */ (undefined));
  let dirty = true;

  // Downstream effects/computeds that read this computed.
  /** @type {Set<() => void>} */
  const dependents = new Set();

  // Called by signal.set() when any of our dependencies change.
  const invalidate = () => {
    if (!dirty) {
      dirty = true;
      for (const sub of [...dependents]) sub();
    }
  };

  return {
    get() {
      // Register this computed as a dependency of the outer effect/computed.
      if (currentEffect) dependents.add(currentEffect);

      if (dirty) {
        // Evaluate fn() with invalidate as the current tracking context so
        // any signals read inside fn() will notify us when they change.
        const prev = currentEffect;
        currentEffect = invalidate;
        try {
          cachedValue = fn();
        } finally {
          currentEffect = prev;
        }
        dirty = false;
      }

      return cachedValue;
    },
  };
}

/**
 * @param {() => void} fn
 * @returns {() => void} dispose
 */
export function effect(fn) {
  let disposed = false;

  const run = () => {
    if (disposed) return;
    const prev = currentEffect;
    currentEffect = run;
    try {
      fn();
    } finally {
      currentEffect = prev;
    }
  };

  run();

  return () => {
    disposed = true;
  };
}
