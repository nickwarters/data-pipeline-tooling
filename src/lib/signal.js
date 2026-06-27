// @ts-check

/**
 * @typedef {{ run: () => void, deps: Set<Set<Observer>>, disposed?: boolean }} Observer
 */

/**
 * @template T
 * @typedef {{ get: () => T, set: (v: T) => void }} Signal
 */

/**
 * @template T
 * @typedef {{ get: () => T }} ComputedSignal
 */

/** @type {Observer|null} */
let currentObserver = null;

/**
 * @param {Set<Observer>} subscribers
 */
function track(subscribers) {
  if (!currentObserver) return;
  subscribers.add(currentObserver);
  currentObserver.deps.add(subscribers);
}

/**
 * @param {Observer} observer
 */
function cleanup(observer) {
  for (const subscribers of observer.deps) subscribers.delete(observer);
  observer.deps.clear();
}

/**
 * @template T
 * @param {T} initialValue
 * @returns {Signal<T>}
 */
export function signal(initialValue) {
  let value = initialValue;
  /** @type {Set<Observer>} */
  const subscribers = new Set();

  return {
    get() {
      track(subscribers);
      return value;
    },
    set(newValue) {
      value = newValue;
      for (const sub of [...subscribers]) sub.run();
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
  /** @type {Set<Observer>} */
  const dependents = new Set();

  // Called by signal.set() when any of our dependencies change.
  /** @type {Observer} */
  const observer = {
    deps: new Set(),
    run() {
      if (!dirty) {
        dirty = true;
        for (const sub of [...dependents]) sub.run();
      }
    },
  };

  return {
    get() {
      // Register this computed as a dependency of the outer effect/computed.
      track(dependents);

      if (dirty) {
        // Evaluate fn() with invalidate as the current tracking context so
        // any signals read inside fn() will notify us when they change.
        cleanup(observer);
        const prev = currentObserver;
        currentObserver = observer;
        try {
          cachedValue = fn();
        } finally {
          currentObserver = prev;
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
  /** @type {Observer} */
  const observer = {
    deps: new Set(),
    disposed: false,
    run() {
      if (observer.disposed) return;
      cleanup(observer);
      const prev = currentObserver;
      currentObserver = observer;
      try {
        fn();
      } finally {
        currentObserver = prev;
      }
    },
  };

  observer.run();

  return () => {
    observer.disposed = true;
    cleanup(observer);
  };
}
