/*!
 * @geoleaf/host-runtime — minimal DOM helpers, shared
 * © 2026 Mattieu Pottier — MIT License
 *
 * Consolidated at STRUCT S2 (F4) from the four `_el` copies of `plugin-measure`,
 * `plugin-print` (×2 — `internal.ts` and `modal-dom.ts`) and `@geoleaf/field-renderer`,
 * and the two byte-identical `applyCssText` of measure and field-renderer (X2e).
 * https://geoleaf.dev
 */

/**
 * Two DOM primitives that every chrome-rendering plugin re-copied.
 *
 * ⚠️ The exported names are `createEl` and `applyStyleText`, NOT `_el` and
 * `applyCssText`. `@geoleaf/field-renderer` defines the underscore names
 * (`helpers.ts`, `dom.ts`) and IS scanned by `verify-plugin-shared-fork`: exporting
 * them here would make that gate red on the library that legitimately owns them.
 * Consumers keep their local vocabulary at the import — `import { createEl as _el }`.
 *
 * field-renderer still carries its own copies: it has no dependency on this package,
 * and adding one to share seven lines would pull a second library into every consumer's
 * type graph. The pair is therefore PINNED in `scripts/verify-seam-drift.cjs` instead —
 * which turns four un-confronted copies into one gated pair.
 */

/**
 * Creates a typed element with an optional class and attributes.
 *
 * @security Sets attributes through `setAttribute` and never touches `innerHTML`. Callers
 * writing user-controlled strings must use `textContent`.
 *
 * @param tag Tag name; the return type follows it via `HTMLElementTagNameMap`.
 * @param className Assigned verbatim when non-empty.
 * @param attrs Applied with `setAttribute`. Absent from field-renderer's `_el`, present
 *   in measure's and print's — this is the superset of the four copies.
 */
export function createEl<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    attrs?: Record<string, string>
): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (attrs) {
        for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    }
    return el;
}

/**
 * Applies a CSS declaration string property-by-property through the CSSOM.
 *
 * @security Unlike `el.style.cssText = …`, per-property `setProperty` writes are NOT
 * subject to the CSP `style-src` directive — this is what makes inline styling
 * strict-CSP-safe (security roadmap B.5). Do not "simplify" it back to `cssText`.
 *
 * `!important` is honoured: it is stripped from the value and passed as the priority
 * argument, because `setProperty` rejects it inline.
 */
export function applyStyleText(el: HTMLElement, css: string): void {
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
