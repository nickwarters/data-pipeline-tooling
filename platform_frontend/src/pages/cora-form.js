// @ts-check
/**
 * The pages for one Form: New form at `#/forms/new`, and a Form itself at
 * `#/forms/<slug>/<id>`. Both live under the Forms guard; which one a route
 * mounts is decided by whether the path names a Form.
 */

import { createFormPageSlice } from './forms/form-page.js';
import { createNewFormSlice } from './forms/new-form.js';

/**
 * @param {Record<string, string>} params
 * @param {import('../setup/register-routes.js').AppContext} context
 * @param {{ now?: () => Date }} [dependencies]
 */
export function createRouteSlice(params, context, dependencies) {
  return params.id
    ? createFormPageSlice(params, context, dependencies)
    : createNewFormSlice(params, context);
}
