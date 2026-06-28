// @ts-check

/**
 * Render output accepted by the future pure-view wrapper.
 * @typedef {Node | Node[] | undefined} ViewRenderResult
 */

/**
 * Cleanup callback registered by lifecycle helpers.
 * @typedef {() => void} Cleanup
 */

/**
 * Props passed to plain function components.
 *
 * @template {Record<string, any>} Props
 * @callback FunctionComponent
 * @param {Readonly<Props>} props
 * @returns {ViewRenderResult}
 */

/**
 * Reactive render function for local-signal UI.
 *
 * @callback ReactiveRender
 * @returns {ViewRenderResult}
 */

/**
 * Context passed to custom-element shell render functions. Prefer plain
 * function components plus reactive() for ordinary feature UI.
 *
 * @template {Record<string, any>} Props
 * @typedef {Object} ViewContext
 * @property {Readonly<Props>} props
 * @property {HTMLElement} host
 */

/**
 * Custom-element shell render function.
 *
 * @template {Record<string, any>} Props
 * @callback ViewRender
 * @param {ViewContext<Props>} context
 * @returns {ViewRenderResult}
 */

/**
 * Hook that runs after a reactive view or custom-element shell is connected.
 *
 * @template {Record<string, any>} Props
 * @callback MountHook
 * @param {ViewContext<Props>} context
 * @returns {void | Cleanup}
 */

/**
 * Declarative custom-element shell definition. This is intentionally not the
 * default component authoring API; most feature UI should be plain functions
 * returning h() nodes, wrapped by reactive() only when it reads local signals.
 *
 * @template {Record<string, any>} Props
 * @typedef {Object} ViewDefinition
 * @property {Props} [props]
 * @property {ViewRender<Props>} render
 * @property {MountHook<Props>} [afterMount]
 */

/**
 * Declarative listener target accepted by the future lifecycle helper.
 * @typedef {EventTarget | (() => EventTarget | null | undefined)} ListenerTarget
 */

/**
 * Lifecycle scope used by reactive() and defineView() to collect mount hooks and
 * cleanup work.
 * Exposed now so lifecycle helper behavior can be tested before defineView()
 * owns render/mount orchestration.
 * @typedef {Object} ViewLifecycle
 * @property {<T>(fn: () => T) => T} run
 * @property {() => void} mount
 * @property {() => void} disconnect
 */

/**
 * Focus snapshot captured before a framework-managed render.
 * @typedef {Object} FocusSnapshot
 * @property {string | null} key
 * @property {number | null} selectionStart
 * @property {number | null} selectionEnd
 */

/** @type {{ cleanups: Cleanup[], mountHooks: Array<() => void | Cleanup>, mounted: boolean } | null} */
let activeLifecycle = null;

/**
 * @param {string} helperName
 * @returns {{ cleanups: Cleanup[], mountHooks: Array<() => void | Cleanup>, mounted: boolean }}
 */
function requireLifecycle(helperName) {
  if (!activeLifecycle) {
    throw new Error(`${helperName}() must be called while a view is mounting`);
  }
  return activeLifecycle;
}

/**
 * TODO(simplify-ui): Wire this lifecycle scope into reactive() for plain
 * function components and defineView() for custom-element shells so ordinary
 * feature components never need to construct it directly.
 *
 * @returns {ViewLifecycle}
 */
export function createLifecycle() {
  const scope = {
    /** @type {Cleanup[]} */
    cleanups: [],
    /** @type {Array<() => void | Cleanup>} */
    mountHooks: [],
    mounted: false,
  };

  return {
    run(fn) {
      const previous = activeLifecycle;
      activeLifecycle = scope;
      try {
        return fn();
      } finally {
        activeLifecycle = previous;
      }
    },
    mount() {
      if (scope.mounted) return;
      scope.mounted = true;
      const previous = activeLifecycle;
      activeLifecycle = scope;
      try {
        for (const hook of scope.mountHooks) {
          const cleanup = hook();
          if (typeof cleanup === 'function') scope.cleanups.push(cleanup);
        }
      } finally {
        activeLifecycle = previous;
      }
    },
    disconnect() {
      for (const cleanup of scope.cleanups.splice(0).reverse()) cleanup();
      scope.mountHooks = [];
      scope.mounted = false;
    },
  };
}

/**
 * TODO(simplify-ui): Implement the default function-component wrapper for
 * local-signal UI. Authors should be able to write `function Question(props) {
 * const response = signal(props.response); return reactive(() => h(...)); }`
 * without classes, connectedCallback, disconnectedCallback, or manual render
 * effects.
 *
 * @param {ReactiveRender} render
 * @returns {HTMLElement | undefined}
 */
export function reactive(render) {
  return undefined;
}

/**
 * TODO(simplify-ui): Implement this only as the custom-element shell escape
 * hatch for route boundaries and SharePoint/browser integration points. Do not
 * make defineView() the default way to author leaf feature components.
 *
 * @template {Record<string, any>} Props
 * @param {string} tagName
 * @param {ViewDefinition<Props>} definition
 */
export function defineView(tagName, definition) {}

/**
 * TODO(simplify-ui): Register an event listener that is automatically removed
 * when the owning reactive() view or custom-element shell disconnects.
 *
 * @param {ListenerTarget} target
 * @param {string} type
 * @param {EventListenerOrEventListenerObject} listener
 * @param {boolean | AddEventListenerOptions} [options]
 */
export function on(target, type, listener, options) {
  const lifecycle = requireLifecycle('on');
  const resolved = typeof target === 'function' ? target() : target;
  if (!resolved) return;
  resolved.addEventListener(type, listener, options);
  lifecycle.cleanups.push(() =>
    resolved.removeEventListener(type, listener, options)
  );
}

/**
 * TODO(simplify-ui): Register mount-time work for the current reactive() view
 * or custom-element shell and capture any returned cleanup callback for
 * automatic disposal.
 *
 * @param {() => void | Cleanup} hook
 */
export function afterMount(hook) {
  requireLifecycle('afterMount').mountHooks.push(hook);
}

/**
 * TODO(simplify-ui): Move duplicated focus-key capture/restore behavior behind
 * the framework render loop.
 *
 * @param {ParentNode | null | undefined} root
 * @returns {FocusSnapshot | undefined}
 */
export function captureFocus(root) {
  return undefined;
}

/**
 * TODO(simplify-ui): Restore a focus snapshot after a framework-managed render.
 *
 * @param {ParentNode | null | undefined} root
 * @param {FocusSnapshot | undefined} snapshot
 */
export function restoreFocus(root, snapshot) {}
