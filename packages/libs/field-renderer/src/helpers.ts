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
 * Résout un libellé, dans cet ordre : dictionnaire de l'hôte, catalogue intégré, clé brute.
 *
 * 🛑 **LE CATALOGUE INTÉGRÉ EST L'APPORT DE LA TÂCHE 5.1c (D6).** Avant lui, la bibliothèque
 * utilisait **43 clés `form.*` qu'elle ne déclarait nulle part** : un hôte qui la chargeait
 * **seule** — sans `editor` ni `addpoi` — voyait `form.error.imageSize` s'afficher tel quel.
 *
 * ⚠️ **L'hôte garde le dernier mot** : son dictionnaire est consulté en premier, donc un
 * intégrateur peut toujours surcharger un libellé. La lecture reste **opportuniste** — la lib
 * ne dépend pas de GeoLeaf et fonctionne quand il est absent.
 *
 * @param key - Clé de libellé.
 * @returns le libellé résolu, ou la clé quand personne ne la connaît.
 */
export function _getLabel(key: string): string {
    const hosted = _g?.GeoLeaf?.I18n?.getLabel?.(key);
    // ⚠️ Un hôte qui ne connaît pas la clé rend LA CLÉ, pas `undefined` — c'est le contrat de
    // `GeoLeaf.I18n`. Sans ce test, le catalogue intégré ne serait jamais atteint.
    if (typeof hosted === "string" && hosted.length > 0 && hosted !== key) return hosted;
    const lang = _g?.GeoLeaf?.I18n?.getActiveLang?.() ?? FALLBACK_LANG;
    return builtinLabel(key, lang) ?? key;
}
