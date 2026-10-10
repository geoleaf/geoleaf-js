/*!
 * @geoleaf/field-renderer — DOM style helpers
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Inline styling that passes a strict CSP — one helper, delegated to `@geoleaf/host-runtime`.
 */

import { applyStyleText } from "@geoleaf/host-runtime";

/**
 * Apply a CSS declaration string property-by-property via the CSSOM
 * (`style.setProperty`). Unlike `el.style.cssText = …`, per-property CSSOM
 * writes are NOT subject to the CSP `style-src` directive — strict-CSP-safe
 * inline styling. `!important` is honoured.
 *
 * A local wrapper over `applyStyleText` of `@geoleaf/host-runtime`, which this library
 * bundles — the body is delegated, the signature is written here, so the published
 * declarations name no private package.
 *
 * @param el  - Target element.
 * @param css - CSS declaration string, e.g. `"display:flex;gap:8px"`.
 */
export function applyCssText(el: HTMLElement, css: string): void {
    applyStyleText(el, css);
}
