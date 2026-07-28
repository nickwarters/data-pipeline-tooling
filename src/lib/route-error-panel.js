// @ts-check

/**
 * Build the plain-DOM panel shown when a route fails to render, keeping one
 * broken route from taking down the app. Shared by the router's mount-failure
 * handler and by `createStoreRoute()`'s post-mount containment, so both paths
 * render identical markup from one place.
 *
 * @returns {HTMLDivElement}
 */
export function createRouteErrorPanel() {
  const panel = document.createElement('div');
  panel.className = 'cora-route-error';
  const heading = document.createElement('p');
  heading.textContent = 'This page failed to load';
  const body = document.createElement('p');
  body.textContent =
    'Use the navigation to go somewhere else, or reload to retry.';
  panel.appendChild(heading);
  panel.appendChild(body);
  return panel;
}
