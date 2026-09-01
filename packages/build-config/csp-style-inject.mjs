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
 * browser (Chrome/Edge 73+, Firefox 101+, Safari 16.4+).
 *
 * ⚠️ **This paragraph said those figures were "the same baseline MapLibre GL JS already
 * requires", and MapLibre v6 has made that false.** Measured on 2026-08-27: the shipped
 * `maplibre-gl@6.5` bundle contains static blocks, `??=`, `?.` and `??` — strict ES2022,
 * i.e. Chrome 94+ / Firefox 93+ / Safari 16.4+. The floor imposed by the mandatory peer is
 * therefore HIGHER than the one written here, not equal to it. The figures above are still
 * right about constructable stylesheets; they are simply no longer the binding constraint,
 * and citing them as the project's baseline would understate it by twenty Chrome versions. Plugin CSS contains no `@import`
 * (verified), which `replaceSync` would otherwise reject.
 *
 * ## 🛑 The `.lazy.css` opt-out — why a stylesheet sometimes must NOT self-inject
 *
 * The injection this function returns is appended at MODULE SCOPE. That is a side effect
 * rollup cannot remove, and it produces a defect that is invisible from either side: a bundle
 * can carry a stylesheet whose JS was tree-shaken away. Measured on 2026-08-27 —
 * `@geoleaf/host-runtime` is inlined into every plugin, and its `tooltip`, `modal-shell` and
 * `confirm-dialog` sheets were injected into **9 plugin bundles whose JS never referenced
 * them**: 5.05 KB gz of stylesheets for dialogs that were not there, adopted into
 * `document.adoptedStyleSheets` on every page load.
 *
 * ⚠️ **Changing the import form alone does NOT fix it**, and that is the trap worth naming:
 * `rollup-plugin-postcss` emits `export default <css>` for every CSS module regardless, so
 * `import css from "…"` still leaves this injection behind it. The side effect has to stop
 * being emitted at all — which is what the suffix below does.
 *
 * A sheet named `*.lazy.css` therefore gets NO injection: the module becomes a pure string
 * export, rollup shakes it together with the code that uses it, and the owner adopts it at call
 * time through `adoptStylesheet(css, key)` (idempotent per key). The convention is a filename
 * so it survives a move, greps in one command, and needs no table to stay in sync.
 *
 * @param {string} cssVariableName - The CSS string variable emitted by
 *   rollup-plugin-postcss for this module.
 * @param {string} [id] - Absolute path of the CSS module, supplied by
 *   rollup-plugin-postcss. Absent only if a caller invokes this directly.
 * @returns {string} Runtime injection code appended to the module, or an empty string for a
 *   `*.lazy.css` sheet, which its owner adopts itself.
 */
export function cspStyleInject(cssVariableName, id) {
    // ⚠️ Tested on the id, never on the variable name: the latter is generated and carries
    // nothing about the file. An absent id falls through to injection — the safe direction,
    // since a sheet that injects twice is idempotent-by-key at worst, whereas one that never
    // injects is a silently unstyled component.
    if (typeof id === "string" && id.split("?")[0].endsWith(".lazy.css")) return "";
    return (
        `\ntry{` +
        `var __glSheet=new CSSStyleSheet();` +
        `__glSheet.replaceSync(${cssVariableName});` +
        `document.adoptedStyleSheets=[...document.adoptedStyleSheets,__glSheet];` +
        `}catch(__glStyleErr){}\n`
    );
}
