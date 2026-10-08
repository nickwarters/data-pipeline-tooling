// @ts-check
import { APP_CONFIG } from '../src/app-config.js';
import { allScopes, groupsForScope } from '../src/reports/report-access.js';

/** @typedef {import('../src/reports/contract.js').ReportPlugin} ReportPlugin */

/**
 * @param {readonly ReportPlugin[]} plugins
 * @returns {{ folder: string, groups: string[], reports: string[] }[]}
 */
export function reportFolderAccess(plugins) {
  /** @type {Map<string, { groups: Set<string>, reports: Set<string> }>} */
  const folders = new Map();
  for (const plugin of plugins) {
    for (const scope of allScopes(plugin)) {
      const groups = groupsForScope(plugin, scope);
      for (const feed of Object.values(plugin.feeds)) {
        const path = feed.path(scope);
        const folder = path.includes('/')
          ? path.slice(0, path.lastIndexOf('/'))
          : '';
        const entry = folders.get(folder) ?? {
          groups: new Set(),
          reports: new Set(),
        };
        for (const group of groups) entry.groups.add(group);
        entry.reports.add(plugin.id);
        folders.set(folder, entry);
      }
    }
  }
  return [...folders.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([folder, { groups, reports }]) => ({
      folder,
      groups: [...groups].sort(),
      reports: [...reports].sort(),
    }));
}

if (import.meta.main) {
  console.log(
    JSON.stringify(reportFolderAccess(APP_CONFIG.reportPlugins), null, 2)
  );
}
