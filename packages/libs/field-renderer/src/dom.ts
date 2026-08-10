/*!
 * @geoleaf/field-renderer — DOM style helpers
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Apply a CSS declaration string property-by-property via the CSSOM
 * (`style.setProperty`). Unlike `el.style.cssText = …`, per-property CSSOM
 * writes are NOT subject to the CSP `style-src` directive — strict-CSP-safe
 * inline styling (security roadmap B.5). Local copy: field-renderer is a pure
 * zero-dependency DOM library and does not import `@geoleaf/core`.
 *
 * @param el  - Target element.
 * @param css - CSS declaration string, e.g. `"display:flex;gap:8px"`.
 */
export function applyCssText(el: HTMLElement, css: string): void {
    if (!el || !css) return;
    for (const decl of css.split(";")) {
        const i = decl.indexOf(":");
        if (i < 0) continue;
        const prop = decl.slice(0, i).trim();
        if (!prop) continue;
        let value = decl.slice(i + 1).trim();
        let priority = "";
        if (/!important$/i.test(value)) {
            priority = "important";
            value = value.replace(/!important$/i, "").trim();
        }
        el.style.setProperty(prop, value, priority);
    }
}
