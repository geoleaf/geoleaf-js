/*!
 * @geoleaf/field-renderer — DOM & i18n helpers
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

import { builtinLabel, FALLBACK_LANG } from "./lang/index.js";

const _g = globalThis as {
    GeoLeaf?: { I18n?: { getLabel?(key: string): string; getActiveLang?(): string } };
};

/**
 * Creates a typed DOM element with optional CSS class.
 * Never use innerHTML — always textContent for user-controlled strings.
 */
export function _el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string
): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    if (className) el.className = className;
    return el;
}

/**
 * Resolves a label, in this order: the host's dictionary, the built-in
 * catalogue, the raw key.
 *
 * 🛑 **THE BUILT-IN CATALOGUE IS THE POINT.** Before it, the library used
 * **43 `form.*` keys it declared nowhere**: a host loading it **alone** —
 * without `editor` or `addpoi` — saw `form.error.imageSize` shown as-is.
 *
 * ⚠️ **The host keeps the last word**: its dictionary is consulted first, so
 * an integrator can always override a label. Reading stays **opportunistic**
 * — the lib does not depend on GeoLeaf and works when it is absent.
 *
 * @param key - Label key.
 * @returns the resolved label, or the key when nobody knows it.
 */
export function _getLabel(key: string): string {
    const hosted = _g?.GeoLeaf?.I18n?.getLabel?.(key);
    // ⚠️ A host that does not know the key returns THE KEY, not `undefined` —
    // `GeoLeaf.I18n`'s contract. Without this test, the built-in catalogue
    // would never be reached.
    if (typeof hosted === "string" && hosted.length > 0 && hosted !== key) return hosted;
    const lang = _g?.GeoLeaf?.I18n?.getActiveLang?.() ?? FALLBACK_LANG;
    return builtinLabel(key, lang) ?? key;
}
