/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/** GeoLeaf UI API - implementation moved out of geoleaf.ui.js */
/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf UI Module - Main Orchestrator (Sprint 4.4 Refactored)
 * Main UI orchestrator — delegates entirely to the sub-modules
 *
 * @author Assistant
 * @version 1.2.0 - Modular Architecture
 *
 * RESPONSIBILITIES:
 * - Unified public API surface
 * - Delegation to the specialised sub-modules
 * - Initialization and coordination of the components
 * - Compatibility layer for legacy code
 *
 * DELEGATED MODULES:
 * - Theme Management    -> _UITheme (ui/theme.js)
 * - Notifications       -> _UINotifications (ui/notifications.js)
 * - Event Delegation    -> _UIEventDelegation (ui/event-delegation.js)
 */

"use strict";

import { Log } from "../../utils/log/index.js";

// ─── GeoLeaf global namespace shape ──────────────────────────────────────────
// The namespace shape (incl. the `_UI*` sub-APIs below) is now declared canonically
// as `GeoLeafGlobal` in `src/global.d.ts` (roadmap_typage-strict.md, S1).

interface UIInitOptions {
    map?: unknown;
    mapContainer?: HTMLElement;
    filterContainer?: HTMLElement;
    buttonSelector?: string;
    autoInitOnDomReady?: boolean;
    enableEventDelegation?: boolean;
    config?: unknown;
}

interface ModuleAvailabilityStatus {
    modules: Record<string, boolean>;
    missing: string[];
    allAvailable: boolean;
}
const _g = (
    typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : {}
) as typeof globalThis & { GeoLeaf: GeoLeafGlobal & { UI: Record<string, unknown> } };
_g.GeoLeaf = _g.GeoLeaf || {};

// ========================================
//   NAMESPACE & DEPENDENCIES
// ========================================

_g.GeoLeaf.UI = _g.GeoLeaf.UI || {};

// ========================================
//   MODULE AVAILABILITY CHECKS
// ========================================

/**
 * Checks whether the required modules are available
 * @returns {Object} Per-module availability report
 */
function checkModuleAvailability(): ModuleAvailabilityStatus {
    const modules = {
        theme: !!_g.GeoLeaf._UITheme,
        // The filter panel is owned by the in-core `filter` capability (mounted on
        // `geoleaf:app:ready`) and is intentionally not probed here. Consumers read the
        // `GeoLeaf.Filter` contract (S13 — the former filter-panel shims were removed).
        notifications: !!_g.GeoLeaf._UINotifications,
        eventDelegation: !!_g.GeoLeaf._UIEventDelegation,
    };

    const missing = Object.entries(modules)
        .filter(([_name, available]) => !available)
        .map(([name]) => name);

    if (missing.length > 0 && Log) {
        Log.warn("[UI.Orchestrator] Modules manquants:", missing.join(", "));
    }

    return { modules, missing, allAvailable: missing.length === 0 };
}

// ========================================
//   API DELEGATION — RETIRÉE (B-60)
// ========================================
//
// Deux blocs vivaient ici : `UI.initThemeToggle`/`applyTheme`/… derrière
// `if (_g.GeoLeaf._UITheme)`, et `UI.Notifications` + les six `UI.show*` derrière
// `if (_g.GeoLeaf._UINotifications)`. Les deux conditions étaient évaluées au CORPS DE MODULE ;
// leurs deux écrivains (`globals.ui.ts` pour le thème, l'installeur de `toast-renderer` pour les
// notifications) n'écrivent qu'AU BOOT, strictement après. Les deux conditions étaient donc
// **toujours fausses**, et les deux blocs n'ont jamais rien monté.
//
// ⚠️ Le bloc thème avait déjà été rattrapé dans `globals.ui.ts` — et c'est ce rattrapage qui a
// masqué l'autre pendant des mois : `UI.applyTheme` fonctionnait, donc rien ne suggérait qu'un
// bloc jumeau restait mort juste en dessous. Les deux surfaces sont désormais câblées au même
// endroit, en délégation paresseuse.

// ========================================
//   EVENT DELEGATION INTEGRATION
// ========================================

let _delegationInitialized = false;

/**
 * Initializes UI event delegation (accordions).
 */
function initializeEventDelegation(): void {
    const delegation = _g.GeoLeaf._UIEventDelegation;
    if (_delegationInitialized || !delegation) return;

    // Filter-input reactivity is owned by the in-core `filter` capability; the former
    // filter-panel refresh wiring here was removed with the legacy filter-panel shims.

    // Event listeners for the accordions.
    //
    // ⚠️ S9 — this currently binds NOTHING, and the fix is not ours to make here.
    // `.gl-poi-panel` was dropped from the selector: no code has ever set that class
    // (its stylesheet, feature-info-panel-content.css, was 100 % unreferenced and was
    // removed at S9 along with the PanelBuilder README documenting an API that no
    // longer exists). What remains, `.gl-filter-panel`, is an **id** everywhere else
    // in the codebase — `#gl-filter-panel` (ui.module.ts:110, desktop-panel.ts:240,
    // mobile-toolbar-sheet.ts:93) — never a class, so this querySelectorAll returns an
    // empty list too. Turning it into `#gl-filter-panel` would ACTIVATE delegation
    // that has been inert for a long time: a behaviour change, out of scope for a CSS
    // sprint. Backlogged rather than silently switched on.
    document.addEventListener("DOMContentLoaded", () => {
        const accordionContainers = document.querySelectorAll(".gl-filter-panel");
        accordionContainers.forEach((container) => {
            delegation.attachAccordionEvents(container);
        });
    });

    _delegationInitialized = true;
    if (Log) Log.info("[UI.Orchestrator] Event delegation initialisée");
}

// ========================================
//   MAIN INITIALIZATION HELPERS
// ========================================

function _checkAndLogModules() {
    const { missing, allAvailable } = checkModuleAvailability();
    if (!allAvailable) {
        if (Log) Log.warn("[UI.Orchestrator] Initialization with missing modules:", missing);
    }
}

function _initThemeControl(config: Record<string, unknown>): void {
    // Apply auto-detection / explicit theme BEFORE the toggle button is initialised
    const uiConfig = (_g.GeoLeaf.Config?.get?.("ui") as Record<string, unknown> | undefined) ?? {};
    const themeConfig = (uiConfig.theme as string | undefined) ?? "auto";
    const autoFn = _g.GeoLeaf.UI.initAutoTheme as ((theme: string) => unknown) | undefined;
    if (typeof autoFn === "function") {
        try {
            autoFn(themeConfig);
        } catch (error) {
            if (Log) Log.error("[UI.Orchestrator] Erreur initAutoTheme:", error);
        }
    }
    const fn = _g.GeoLeaf.UI.initThemeToggle as
        | ((config: Record<string, unknown>) => unknown)
        | undefined;
    if (typeof fn !== "function") return;
    try {
        fn(config);
    } catch (error) {
        if (Log) Log.error("[UI.Orchestrator] Erreur init th\u00e8me:", error);
    }
}

// ========================================
//   MAIN INITIALIZATION
// ========================================

/**
 * Main entry point for UI initialization
 * @param {Object} options - Options d'initialization
 * @param {HTMLElement} options.map - Instance de carte MapLibre
 * @param {HTMLElement} options.mapContainer - Map DOM container
 * @param {HTMLElement} options.filterContainer - Filter container
 * @param {string} options.buttonSelector - Theme button selector
 * @param {boolean} options.autoInitOnDomReady - Auto-init on DOMContentLoaded
 * @param {boolean} options.enableEventDelegation - Enable event delegation (default: true)
 */
_g.GeoLeaf.UI.init = function (options: UIInitOptions = {}) {
    const config = {
        buttonSelector: options.buttonSelector || '[data-gl-role="theme-toggle"]',
        autoInitOnDomReady: !!options.autoInitOnDomReady,
        enableEventDelegation: options.enableEventDelegation !== false,
    };

    _checkAndLogModules();
    _initThemeControl(config);

    if (config.enableEventDelegation) {
        initializeEventDelegation();
    }

    if (Log) {
        Log.info(
            `[UI.Orchestrator] Initialisation termin\u00e9e (modules: ${Object.keys(checkModuleAvailability().modules).length})`
        );
    }
};

// ========================================
//   UTILITY & DEBUG FUNCTIONS
// ========================================

/**
 * Debug information about module state
 * @returns {Object} Detailed module status
 */
_g.GeoLeaf.UI.getModuleStatus = function () {
    return checkModuleAvailability();
};

/**
 * General teardown of the UI resources
 */
_g.GeoLeaf.UI.cleanup = function () {
    // Event listener teardown
    if (_g.GeoLeaf._UIEventDelegation && _g.GeoLeaf._UIEventDelegation.cleanupAllListeners) {
        const cleaned = _g.GeoLeaf._UIEventDelegation.cleanupAllListeners();
        if (Log && cleaned > 0) {
            Log.info(`[UI.Orchestrator] ${cleaned} event listeners nettoyés`);
        }
    }

    // Reset delegation flag
    _delegationInitialized = false;

    if (Log) Log.info("[UI.Orchestrator] Nettoyage terminé");
};

// Version info
_g.GeoLeaf.UI.VERSION = "4.4.0";
_g.GeoLeaf.UI.BUILD = "Sprint-4.4-Modular";

if (Log) {
    Log.info(`[UI.Orchestrator] Module initialise v${_g.GeoLeaf.UI.VERSION as string}`);
}

const UI = _g.GeoLeaf.UI;
export { UI };
