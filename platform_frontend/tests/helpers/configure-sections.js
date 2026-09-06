// @ts-check
import { APP_CONFIG } from '../../src/app-config.js';
import { configureSections } from '../../src/sections/registry.js';

/**
 * Configure the Section engine with this application's Sections, the way boot
 * does.
 *
 * The engine holds no list of its own, so a test that reads a Section has to
 * say what the application is made of first — there is nothing to fall back
 * to, and a read before configuration throws rather than answering with an
 * empty registry. Call it once at the top of the file, beneath the imports —
 * and call it again to clean up after a test that stood a fixture Section in
 * for another, since composing is also how a caller puts back what it composed.
 */
export function configureAppSections() {
  configureSections(APP_CONFIG.sectionPlugins);
}
