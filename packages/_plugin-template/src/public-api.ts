/*!
 * __PLUGIN_PKG__ — Public API facade
 * © 2026 Mattieu Pottier — MIT License
 *
 * Façade only: exposes the plugin's public surface (INV-FACADE). Methods are
 * thin wrappers that delegate to internal modules — no business logic here.
 * https://geoleaf.dev
 */

/* <ui> */
/**
 * Root CSS class of the plugin's own DOM — the single owner of the stylesheet's namespace.
 *
 * ⚠️ It is declared HERE, and not inlined at the point of use, for a mechanical reason: PurgeCSS
 * extracts its candidates from the source text, so a class that appears in no source is DEAD to
 * it. The scaffold shipped `.gl-__PLUGIN_NAME__` in its stylesheet and used it nowhere, which
 * made `verify-purgecss.cjs` red on the very first run of every new plugin — a defect each new
 * plugin inherited, and paid, in silence.
 *
 * Build the plugin's markup under this class: the stylesheet is scoped to it.
 */
export const ROOT_CLASS = "gl-__PLUGIN_NAME__";
/* </ui> */

/**
 * Builds the object mounted on `GeoLeaf.__PLUGIN_NAMESPACE__`.
 */
export function buildPublicApi() {
    return {
        /** Plugin entry point — replace with the real public methods. */
        open(): void {
            // TODO: delegate to the plugin's internal logic, rendered under `ROOT_CLASS`.
        },
    };
}
