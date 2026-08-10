/*!
 * @geoleaf-plugins/offline-ui
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @fileoverview Cache toolbar registration
 * @description Registers the offline-cache button as a core toolbar slot
 * (desktop band + mobile pill) via `GeoLeaf.registry.register`, replacing the
 * former top-left MapLibre IControl, and opens the modal on toolbar action.
 *
 * Extracted from entry.ts so the registration + event wiring can be unit-tested
 * in isolation (no heavy module graph).
 * @version 1.0.0
 */

// Forme du seam toolbar importée du contrat publié (API publique S3) au lieu d'une
// re-déclaration locale : les 7 plugins en portaient 4 formes divergentes. Celle d'ici
// (`{ action?: string }`) était la plus laxiste — l'émetteur pose toujours `action`.
import type { GeoLeafRawEventMap } from "@geoleaf/core";

/** Minimal shape of the global GeoLeaf surface used here. */
interface GeoLeafToolbarHost {
    GeoLeaf?: {
        registry?: { register?: (mod: { id: string; ui?: Record<string, unknown> }) => void };
        UI?: { CacheButton?: { openModal?: () => void } };
    };
}

// Offline-cache icon (refresh, 22px, stroke currentColor) — sanitised by core
// DOMSecurity.setSafeHTML when the slot is rendered.
const CACHE_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"' +
    ' stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>' +
    "</svg>";

/**
 * Toolbar action id shared between the slot definition and the listener.
 *
 * ⚠️ STRUCT S3.2 — c'est l'id qui sort dans le DOM (`data-gl-toolbar-action`) et que
 * deux specs E2E ciblent. Il suit le renommage du plugin, contrairement au préfixe des
 * clés i18n (`storage.*`), qui reste : celui-là est une surface d'OVERRIDE DE PROFIL
 * (`_overrides[key]` dans `utils/i18n/i18n.ts`), donc un contrat public plus large que
 * l'identité du plugin. Les deux namespaces sont indépendants — `registerDict` ne fait
 * que ranger dans un seau, la résolution passe par la clé plate.
 */
const CACHE_TOOLBAR_ACTION = "offline-ui";

/**
 * Registers the cache toolbar slot and wires the open-modal listener.
 * Visibility is gated by the `ui.showCacheButton` profile key (handled by the
 * core) and `requiresPlugin: "offline-ui"`.
 *
 * @param host - the global object exposing `GeoLeaf` (defaults to globalThis).
 */
export function registerCacheToolbar(
    host: GeoLeafToolbarHost = globalThis as unknown as GeoLeafToolbarHost
): void {
    const slot = {
        icon: CACHE_ICON,
        labelKey: "storage.toolbar.button",
        profileKey: "ui.showCacheButton",
        // Opt-in: hidden unless the profile sets ui.showCacheButton:true
        // (matches ui.showAddPoi; documented default false in the config guide).
        defaultVisible: false,
        requiresPlugin: "offline-ui",
        action: CACHE_TOOLBAR_ACTION,
    };

    host.GeoLeaf?.registry?.register?.({
        id: "offline-ui",
        ui: { mobileIcon: { ...slot }, desktopTabButton: { ...slot } },
    });

    if (typeof document !== "undefined") {
        document.addEventListener("geoleaf:toolbar:action", (e: Event) => {
            const ce = e as CustomEvent<GeoLeafRawEventMap["geoleaf:toolbar:action"]>;
            if (ce.detail?.action === CACHE_TOOLBAR_ACTION) {
                host.GeoLeaf?.UI?.CacheButton?.openModal?.();
            }
        });
    }
}
