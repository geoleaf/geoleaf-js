/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description Security functions for GeoLeaf — HTML escaping, URL validation, sanitization.
 *
 * Public barrel: re-exports the escaping, validation and sanitization sub-modules and
 * exposes the aggregate `Security` facade. Implementation lives in `./escaping.js`,
 * `./validators.js` and `./sanitizers.js`.
 */

export type { SafeElementOptions } from "./escaping.js";
export type { ValidateUrlOptions } from "./validators.js";
export type { SanitizeHtmlOptions } from "./sanitizers.js";
export type { SVGIconOptions } from "./dom-security.js";

export { escapeHtml, escapeAttribute, createSafeElement } from "./escaping.js";
export {
    validateUrl,
    validateCoordinates,
    validateNumber,
    isAllowedDataUrlType,
    extractDataUrlMimeType,
    ALLOWED_DATA_URL_TYPES,
    resolveBaseUrl,
} from "./validators.js";
export {
    containsDangerousHtml,
    stripHtml,
    sanitizeSvgContent,
    parseHtmlSafely,
    sanitizeHTML,
} from "./sanitizers.js";

// STRUCT S6 — `DOMSecurity` joined this directory (ex-`utils/general/dom-security.ts`, verdict
// E3: it was the DOM façade of this very module and carried the only `utils/ → kernel/` edge
// the corpus judged blocking). Re-exporting it here is NOT optional: the eslint boundary
// (bloc 6ter ter) lets `capabilities/**` reach `kernel/<dir>/index.js` and nothing else, and
// 7 capability files consume it — geolocation, legend, share ×2, theme-selector ×2, theme-toggle.
// Kept OUT of the `Security` aggregate below: `GeoLeaf.DOMSecurity` is a sibling namespace of
// `GeoLeaf.Security` (globals.core.ts), not a member of it — folding it in would change the
// public surface, which this sprint does not do.
export { DOMSecurity } from "./dom-security.js";

import { escapeHtml, escapeAttribute, createSafeElement } from "./escaping.js";
import { validateUrl, validateCoordinates, validateNumber } from "./validators.js";
import { CSRFToken } from "./csrf-token.js";
import {
    containsDangerousHtml,
    stripHtml,
    sanitizeSvgContent,
    parseHtmlSafely,
    sanitizeHTML,
} from "./sanitizers.js";

// ── Aggregate export (facade) ──

/**
 * The `GeoLeaf.Security` façade — sanitisation, URL vetting and CSRF.
 *
 * ⚠️ Every DOM write that carries data from a profile or a server must pass through here.
 * The helpers exist precisely so `innerHTML` is never reached for directly. This directory is
 * the XSS/CSRF surface of the kernel: bypassing them, or reaching for `innerHTML` without
 * going through them, is the one thing that is never acceptable here.
 */
export const Security = {
    escapeHtml,
    escapeAttribute,
    validateUrl,
    validateCoordinates,
    containsDangerousHtml,
    stripHtml,
    createSafeElement,
    sanitizeSvgContent,
    validateNumber,
    parseHtmlSafely,
    sanitizeHTML,
    // Part of the barrel since KERNEL S14 (backlog B.16). It used to be grafted onto the
    // namespace separately, in `globals.core.ts` — so this barrel, which every reader
    // treats as the definition of `GeoLeaf.Security`, was NOT its single source: importing
    // it gave a namespace one member short of the runtime one. No cycle: `csrf-token.ts`
    // imports only `Log`.
    CSRFToken,
};

export { CSRFToken } from "./csrf-token.js";
