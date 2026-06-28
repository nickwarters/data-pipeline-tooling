// @ts-check
import { CRElement } from './cr-element.js';
import { effect } from '../lib/signal.js';

/**
 * ReactiveElement is a base class that extends CRElement to provide automatic
 * reactivity. Instead of manual `.subscribe()`, it calls a `render()` method
 * inside an effect. Any signals read during `render()` will automatically trigger
 * a re-render when they change.
 *
 * TODO(simplify-ui): Replace direct subclass authoring with plain function
 * components that return h() nodes, using reactive() from src/lib/view.js when
 * local signals drive re-rendering. Keep custom elements only for route or
 * browser-integration shells.
 */
export class ReactiveElement extends CRElement {
  constructor() {
    super();
    /** @type {(() => void) | null} */
    this._renderDispose = null;
  }

  connectedCallback() {
    // We run render() inside an effect so it tracks dependencies automatically
    this._renderDispose = effect(() => {
      const content = this.render();
      if (content !== undefined) {
        // Simple wipe and replace. For highly dynamic lists we'd want diffing,
        // but for forms replacing children is very fast.
        if (
          content &&
          typeof content === 'object' &&
          'appendChild' in content
        ) {
          this.replaceChildren(content);
        } else if (Array.isArray(content)) {
          this.replaceChildren(...content);
        } else {
          this.replaceChildren(); // empty
        }
      }
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._renderDispose) {
      this._renderDispose();
      this._renderDispose = null;
    }
  }

  /**
   * Overridden by subclasses. Return a DOM node (e.g. from `h()`), an array of nodes, or undefined.
   * @returns {Node | Node[] | undefined}
   */
  render() {
    return undefined;
  }
}
