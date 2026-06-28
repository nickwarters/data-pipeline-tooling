// @ts-check
import { ReactiveElement } from '../components/reactive-element.js';
import { HomePage } from './home-page.js';

/** @typedef {import('../services/permissions.js').Capabilities} Capabilities */

export { HomePage };

// TODO(simplify-ui): Remove this compatibility wrapper after routes and tests
// consume HomePage() directly everywhere. Keep custom elements only where the
// browser boundary itself is useful.
export class CRHome extends ReactiveElement {
  constructor() {
    super();
    /** @type {Capabilities | null} */
    this.capabilities = null;
  }

  render() {
    return HomePage({ capabilities: this.capabilities });
  }
}

customElements.define('cr-home', CRHome);
