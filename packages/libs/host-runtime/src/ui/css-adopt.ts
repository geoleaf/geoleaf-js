/*!
 * @geoleaf/host-runtime — CSP-safe stylesheet injection
 * © 2026 Mattieu Pottier — MIT License
 *
 * Consolidated at PLUGINS S1 from the byte-identical copies carried by
 * `plugin-editor` and `plugin-connector`.
 * https://geoleaf.dev
 */

/** Keys already adopted, to keep injection idempotent. */
const _adopted = new Set<string>();

/**
 * Apply a CSS string through a constructable stylesheet
 * (`new CSSStyleSheet().replaceSync(css)` + `document.adoptedStyleSheets`)
 * instead of a `<style>` element. Constructable stylesheets are NOT subject
 * to the CSP `style-src` directive, so this works under a strict
 * `style-src 'self'` (no `'unsafe-inline'`) — security roadmap B.7.
 *
 * Idempotent per `key`: a given key is adopted at most once. No `<style>`
 * fallback (it would be blocked under strict CSP anyway); constructable
 * stylesheets ship in all modern evergreen browsers.
 *
 * ⚠️ The dedup set is module-scoped, and this module is bundled into each plugin
 * separately (it is a devDependency, never a shared runtime instance). Two plugins
 * adopting the same `key` therefore each adopt once — which is the pre-consolidation
 * behaviour, preserved deliberately: the keys are plugin-prefixed (`gc-style`,
 * `gl-editor-form`), so they do not collide in practice.
 *
 * @param css - Static, code-owned CSS (no user data, no `@import`).
 * @param key - Stable identity for the stylesheet (replaces the former
 *   `<style id="…">` dedup).
 */
export function adoptStylesheet(css: string, key: string): void {
    if (_adopted.has(key)) return;
    try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
        _adopted.add(key);
    } catch {
        // Constructable stylesheets unsupported (very old browser): skip.
    }
}
