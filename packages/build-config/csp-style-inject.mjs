/*!
 * GeoLeaf — CSP-safe CSS injector for rollup-plugin-postcss
 * © 2026 Mattieu Pottier
 */

/**
 * Build-time helper for the `inject` option of `rollup-plugin-postcss`.
 *
 * Returns the runtime JS that applies a bundled CSS string through a
 * **constructable stylesheet** (`new CSSStyleSheet().replaceSync(css)` +
 * `document.adoptedStyleSheets`) instead of the default `styleInject`
 * helper, which creates a `<style>` element and sets its `textContent`.
 *
 * A `<style>` element's content is subject to the CSP `style-src` directive
 * and is therefore blocked under a strict `style-src 'self'` (no
 * `'unsafe-inline'`). Constructable stylesheets are NOT subject to
 * `style-src`, so plugin CSS loads cleanly under the strict policy
 * (security roadmap B.7).
 *
 * No `<style>` fallback is emitted: under a strict CSP it would be blocked
 * anyway, and constructable stylesheets ship in every modern evergreen
 * browser (Chrome/Edge 73+, Firefox 101+, Safari 16.4+) — the same baseline
 * MapLibre GL JS already requires. Plugin CSS contains no `@import`
 * (verified), which `replaceSync` would otherwise reject.
 *
 * @param {string} cssVariableName - The CSS string variable emitted by
 *   rollup-plugin-postcss for this module.
 * @returns {string} Runtime injection code appended to the module.
 */
export function cspStyleInject(cssVariableName) {
    return (
        `\ntry{` +
        `var __glSheet=new CSSStyleSheet();` +
        `__glSheet.replaceSync(${cssVariableName});` +
        `document.adoptedStyleSheets=[...document.adoptedStyleSheets,__glSheet];` +
        `}catch(__glStyleErr){}\n`
    );
}
