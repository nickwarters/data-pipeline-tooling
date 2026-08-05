// @ts-check

/** @type {Record<string, () => Promise<any>>} */
const importers = {
  complaints: () => import('./complaints.js'),
};

/** @param {string} slug */
export async function loadNewDashboardConfig(slug) {
  const importer = importers[slug];
  if (!importer) throw new Error(`Unsupported Case Type "${slug}".`);
  return (await importer()).default;
}
