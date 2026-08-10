/*!
 * @geoleaf-plugins/offline-ui
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @fileoverview UI Cache Button - Orchestrator (Pattern A ESM)
 * @description Main API entry point that delegates to specialized modules
 * @author GeoLeaf Team
 * @version 4.0.0
 *
 * ARCHITECTURE:
 * This orchestrator imports sub-modules directly (Pattern A — real ESM).
 * - ButtonControl: MapLibre IControl button creation
 * - ModalManager: Modal structure and navigation
 * - ExportLogic: POI export, sync, and cache management
 */
import { Log, getGeoLeaf } from "@geoleaf/host-runtime";
import { ButtonControl } from "./cache-button/button-control.js";
import { ModalManager } from "./cache-button/modal-manager.js";
import { ExportLogic } from "./cache-button/export-logic.js";

// Wire cross-references via injection (avoids circular imports)
ModalManager._setExportLogic(ExportLogic);

/**
 * CacheButton (Orchestrator)
 * Delegates all functionality to specialized sub-modules via direct ESM imports.
 */
const CacheButton = {
    init(map: unknown, cfg: { ui?: { showCacheButton?: boolean }; [key: string]: unknown }) {
        return ButtonControl.init(map, cfg);
    },
    openModal() {
        return ModalManager.openModal();
    },
    closeModal() {
        return ModalManager.closeModal();
    },
    // Expose sub-modules for globals.js UMD compat assignment
    Modules: { ButtonControl, ModalManager, ExportLogic },
};

Log?.info?.("[UI.CacheButton] Orchestrator initialized");

// Register with GeoLeaf.UI so core's `app/boot-modules/ui.module.ts:119` can reach it.
//
// ⚠️ B-202 (09/08/2026) — accesseur canonique de `@geoleaf/host-runtime`, PAS un
// `globalThis as { GeoLeaf?: { UI?: Record<string, unknown> } }` local. La forme locale a
// cessé de compiler le jour où `GeoLeafUIFacade` a perdu sa traîne `[key: string]: unknown`
// (TS2352, « neither type sufficiently overlaps ») : elle ne décrivait pas le namespace, elle
// en affirmait une vue plus permissive que la vraie. C'est exactement le collatéral B-52, et
// c'est aussi ce que `shared/storage-contract.ts:34` avait déjà consigné pour le même motif —
// « c'est exactement ce que ce paquet existe pour remplacer ».
const _uiFacade = getGeoLeaf()?.UI;
if (_uiFacade) {
    _uiFacade.CacheButton = CacheButton;
}
