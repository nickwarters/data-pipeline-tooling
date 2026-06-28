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
 * Context passed to pure view render functions.
 *
 * @template {Record<string, any>} Props
 * @typedef {Object} ViewContext
 * @property {Readonly<Props>} props
 * @property {HTMLElement} host
 */

/**
 * Pure render function for a custom-element-backed view.
 *
 * @template {Record<string, any>} Props
 * @callback ViewRender
 * @param {ViewContext<Props>} context
 * @returns {ViewRenderResult}
 */

/**
 * Hook that runs after the host element is connected.
 *
 * @template {Record<string, any>} Props
 * @callback MountHook
 * @param {ViewContext<Props>} context
 * @returns {void | Cleanup}
 */

/**
 * Declarative view definition used by the future component authoring API.
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
 * Focus snapshot captured before a framework-managed render.
 * @typedef {Object} FocusSnapshot
 * @property {string | null} key
 * @property {number | null} selectionStart
 * @property {number | null} selectionEnd
 */

/**
 * TODO(simplify-ui): Implement the pure authoring wrapper so feature authors
 * can define custom-element-backed views without writing classes,
 * connectedCallback, disconnectedCallback, or manual render effects.
 *
 * @template {Record<string, any>} Props
 * @param {string} tagName
 * @param {ViewDefinition<Props>} definition
 */
export function defineView(tagName, definition) {}

/**
 * TODO(simplify-ui): Register an event listener that is automatically removed
 * when the owning view disconnects.
 *
 * @param {ListenerTarget} target
 * @param {string} type
 * @param {EventListenerOrEventListenerObject} listener
 * @param {boolean | AddEventListenerOptions} [options]
 */
export function on(target, type, listener, options) {}

/**
 * TODO(simplify-ui): Register mount-time work for the current view context and
 * capture any returned cleanup callback for automatic disposal.
 *
 * @param {() => void | Cleanup} hook
 */
export function afterMount(hook) {}

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
