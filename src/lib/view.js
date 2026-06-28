// @ts-check
import { effect } from './signal.js';

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
 * @property {Element | null} element
 */

/** @type {{ cleanups: Cleanup[], mountHooks: Array<() => void | Cleanup>, mounted: boolean } | null} */
let activeLifecycle = null;

const HTMLElementBase = /** @type {typeof HTMLElement} */ (
  /** @type {unknown} */ (globalThis.HTMLElement ?? class {})
);

/**
 * @param {ViewRenderResult} content
 * @returns {Node[]}
 */
function normalizeRenderResult(content) {
  if (content === undefined) return [];
  return Array.isArray(content) ? content : [content];
}

/**
 * @param {HTMLElement} host
 * @param {ViewRenderResult} content
 */
function replaceHostChildren(host, content) {
  host.replaceChildren(...normalizeRenderResult(content));
}

/**
 * @param {HTMLElement} host
 * @param {() => ViewRenderResult} render
 * @returns {Cleanup}
 */
function mountReactiveRender(host, render) {
  const lifecycle = createLifecycle();
  const disposeEffect = effect(() => {
    const snapshot = captureFocus(host);
    lifecycle.disconnect();
    const content = lifecycle.run(render);
    replaceHostChildren(host, content);
    lifecycle.mount();
    restoreFocus(host, snapshot);
  });

  return () => {
    disposeEffect();
    lifecycle.disconnect();
    host.replaceChildren();
  };
}

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
 * Lifecycle scope used by reactive() and defineView() so ordinary feature
 * components do not need to construct it directly.
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
 * Default function-component wrapper for local-signal UI. Authors can write
 * `function Question(props) {
 * const response = signal(props.response); return reactive(() => h(...)); }`
 * without classes, connectedCallback, disconnectedCallback, or manual render
 * effects.
 *
 * @param {ReactiveRender} render
 * @returns {HTMLElement}
 */
export function reactive(render) {
  const host = document.createElement('div');
  const disconnect = mountReactiveRender(host, render);
  /** @type {any} */ (host).disconnectedCallback = disconnect;
  return host;
}

/**
 * Minimal custom-element shell for the remaining browser integration points.
 * Prefer plain functions returning h() nodes for feature UI; use this only when
 * a DOM-defined element boundary is still required by routes or existing tests.
 */
export class ShellElement extends HTMLElementBase {
  constructor() {
    super();
    /** @type {Cleanup | null} */
    this._viewDisconnect = null;
    /** @type {(() => void) | null} */
    this._shellRenderNow = null;
    /** @type {Cleanup[]} */
    this._shellDisposes = [];
  }

  connectedCallback() {
    if (this._viewDisconnect) {
      this._shellRenderNow?.();
      return;
    }
    const host = /** @type {HTMLElement} */ (this);
    const lifecycle = createLifecycle();
    const renderNow = () => {
      const snapshot = captureFocus(host);
      lifecycle.disconnect();
      const content = lifecycle.run(() => this.render());
      replaceHostChildren(host, content);
      lifecycle.mount();
      restoreFocus(host, snapshot);
    };
    this._shellRenderNow = renderNow;
    const disposeEffect = effect(renderNow);
    this._viewDisconnect = () => {
      disposeEffect();
      lifecycle.disconnect();
    };
  }

  disconnectedCallback() {
    if (!this._viewDisconnect) return;
    this._viewDisconnect();
    this._viewDisconnect = null;
    this._shellRenderNow = null;
    for (const dispose of this._shellDisposes.splice(0).reverse()) dispose();
  }

  /** @returns {ViewRenderResult} */
  render() {
    return undefined;
  }

  /**
   * @template T
   * @param {{ get: () => T }} sig
   * @param {(value: T) => void} cb
   */
  subscribe(sig, cb) {
    this._shellDisposes.push(effect(() => cb(sig.get())));
  }
}

/**
 * Custom-element shell escape hatch for route boundaries and
 * SharePoint/browser integration points. Do not make defineView() the default
 * way to author leaf feature components.
 *
 * @template {Record<string, any>} Props
 * @param {string} tagName
 * @param {ViewDefinition<Props>} definition
 * @returns {CustomElementConstructor & { new(): HTMLElement & Props & { connectedCallback: () => void, disconnectedCallback: () => void } }}
 */
export function defineView(tagName, definition) {
  class ViewElement extends HTMLElement {
    constructor() {
      super();
      Object.assign(this, definition.props ?? {});
      /** @type {Cleanup | null} */
      this._viewDisconnect = null;
    }

    connectedCallback() {
      if (this._viewDisconnect) return;
      const host = /** @type {HTMLElement} */ (this);
      this._viewDisconnect = mountReactiveRender(host, () => {
        const context = {
          props: /** @type {any} */ (this),
          host,
        };
        const content = definition.render(context);
        if (definition.afterMount) {
          afterMount(() => definition.afterMount?.(context));
        }
        return content;
      });
    }

    disconnectedCallback() {
      if (!this._viewDisconnect) return;
      this._viewDisconnect();
      this._viewDisconnect = null;
    }
  }

  customElements.define(tagName, ViewElement);
  return /** @type {CustomElementConstructor & { new(): HTMLElement & Props & { connectedCallback: () => void, disconnectedCallback: () => void } }} */ (
    /** @type {unknown} */ (ViewElement)
  );
}

/**
 * Register an event listener that is automatically removed when the owning
 * reactive() view or custom-element shell disconnects.
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
 * Register mount-time work for the current reactive() view or custom-element
 * shell and capture any returned cleanup callback for automatic disposal.
 *
 * @param {() => void | Cleanup} hook
 */
export function afterMount(hook) {
  requireLifecycle('afterMount').mountHooks.push(hook);
}

/**
 * Capture the active data-focus-key and selection before a framework-managed
 * render.
 *
 * @param {ParentNode | null | undefined} root
 * @returns {FocusSnapshot | undefined}
 */
export function captureFocus(root) {
  const active = /** @type {any} */ (document.activeElement);
  if (!active || typeof active.getAttribute !== 'function') return undefined;

  const key = active.getAttribute('data-focus-key');
  if (!key || !root?.querySelector) return undefined;

  if (!containsNode(root, active)) return undefined;

  return {
    key,
    selectionStart:
      typeof active.selectionStart === 'number' ? active.selectionStart : null,
    selectionEnd:
      typeof active.selectionEnd === 'number' ? active.selectionEnd : null,
    element: active,
  };
}

/**
 * Restore a focus snapshot after a framework-managed render.
 *
 * @param {ParentNode | null | undefined} root
 * @param {FocusSnapshot | undefined} snapshot
 */
export function restoreFocus(root, snapshot) {
  if (!snapshot?.key || !root?.querySelector) return;
  const selector = `[data-focus-key="${escapeSelectorValue(snapshot.key)}"]`;
  const next = /** @type {any} */ (
    snapshot.element && containsNode(root, snapshot.element)
      ? snapshot.element
      : root.querySelector(selector)
  );
  if (!next || typeof next.focus !== 'function') return;

  next.focus();
  if (
    typeof next.setSelectionRange === 'function' &&
    snapshot.selectionStart !== null &&
    snapshot.selectionEnd !== null
  ) {
    next.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
  }
}

/**
 * @param {ParentNode} root
 * @param {Element} node
 * @returns {boolean}
 */
function containsNode(root, node) {
  if ('contains' in root && typeof root.contains === 'function') {
    return root.contains(node);
  }

  /** @param {any} current */
  const walk = (current) => {
    for (const child of current?._children ?? []) {
      if (child === node || walk(child)) return true;
    }
    return false;
  };
  return walk(root);
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeSelectorValue(value) {
  return globalThis.CSS?.escape
    ? globalThis.CSS.escape(value)
    : value.replace(/(["\\])/g, '\\$1');
}
