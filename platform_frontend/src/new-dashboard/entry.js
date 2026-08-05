export {};
import { installRouteBoundaryReload } from './route-boundary.js';

installRouteBoundaryReload(window);

if (/^#\/new_dashboard\//.test(location.hash)) {
  const { startNewDashboard } = await import('./browser.js');
  await startNewDashboard();
} else {
  await import('../app.js');
}
