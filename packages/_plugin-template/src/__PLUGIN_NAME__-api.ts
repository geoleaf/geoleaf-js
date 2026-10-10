/*!
 * __PLUGIN_PKG__ — Domain module
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Implementation behind the public façade of `__PLUGIN_PKG__`.
 *
 * `public-api.ts` only delegates here (INV-FACADE): the behaviour, and the tests that hold
 * it, live in this module. It reads the plugin's configuration through `getPluginConfig()`
 * and through nothing else.
 *
 * ⚠️ This module exists in the scaffold for a measured reason. Until 10/10/2026 the template
 * shipped a façade whose only method had an empty body, and a `config.ts` nothing imported: a
 * freshly generated plugin reddened the façade-purity gate, the module-graph gate (an orphan
 * module) and its own coverage threshold — at 0 %, since the two files that carried code
 * were the two excluded from the measure. Each new plugin paid those by hand.
 */

import { getPluginConfig } from "./config.js";

/* <ui> */
/**
 * Root CSS class of the plugin's own DOM — the single owner of the stylesheet's namespace.
 *
 * ⚠️ It is written HERE, in a source file, for a mechanical reason: PurgeCSS extracts its
 * candidates from the source text, so a class that appears in no source is DEAD to it. The
 * scaffold once shipped `.gl-__PLUGIN_NAME__` in its stylesheet and used it nowhere, which
 * reddened `verify-purgecss.cjs` on the very first run of every new plugin.
 *
 * Build the plugin's markup under this class: the stylesheet is scoped to it.
 */
const ROOT_CLASS = "gl-__PLUGIN_NAME__";
/* </ui> */

/**
 * Opens the plugin — replace the body with the plugin's real behaviour.
 *
 * @returns `false` when the profile switched the plugin off
 *   (`modules.__PLUGIN_NAME__.enabled: false`), `true` once it is open.
 */
export function open__PLUGIN_NAMESPACE__(): boolean {
    if (!getPluginConfig().enabled) return false;
    /* <ui> */
    if (!document.querySelector(`.${ROOT_CLASS}`)) {
        const root = document.createElement("div");
        root.className = ROOT_CLASS;
        document.body.append(root);
    }
    /* </ui> */
    return true;
}
