/*!
 * GeoLeaf Core – App / Helpers
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Application Helpers
 * Production logging, path detection, plugin verification,
 * and notification helper.
 *
 * This file creates the shared GeoLeaf._app namespace used by
 * app/boot.js and the boot module classes (app/boot-modules/*.js).
 */
import { ensureGeoLeaf } from "../utils/general/geoleaf-global.js";
import type { AppNamespace } from "./app-types.js";
import { notifyPrimitive } from "../utils/notify/notify.primitive.js";
import type { GeoLeafConfig } from "../kernel/config/geoleaf-config/config-types.js";

const GeoLeaf = ensureGeoLeaf();

/**
 * Internal namespace for the Application Bootstrap module.
 * Shared between app/app-namespace.js, app/boot.js and the boot module classes.
 * @namespace GeoLeaf._app
 * @private
 */
const _app = (GeoLeaf._app = GeoLeaf._app || {}) as AppNamespace;

// ============================================================
// Production logging system
// ============================================================
_app.AppLog = {
    log(...args: unknown[]) {
        if (location.search.includes("debug=true")) {
            // eslint-disable-next-line no-console -- intentional debug output when ?debug=true
            console.debug("[GeoLeaf]", ...args);
        }
    },
    info(...args: unknown[]) {
        console.info("[GeoLeaf]", ...args);
    },
    error(...args: unknown[]) {
        console.error("[GeoLeaf]", ...args);
    },
    warn(...args: unknown[]) {
        console.warn("[GeoLeaf]", ...args);
    },
};

// ============================================================
// Automatic path detection for profiles/
// ============================================================
/**
 * Automatically detects the base path to the profiles/ folder
 * based on the current URL.
 * @returns {string} Relative path to profiles/
 */
_app.getProfilesBasePath = function () {
    const currentPath = location.pathname;
    if (currentPath.includes("/demo/")) {
        return "../profiles/";
    }
    return "./profiles/";
};

// ============================================================
// Plugin verification at boot
// ============================================================
/**
 * Verifies that required plugins for the configuration are loaded
 * and prints console warnings if they are missing.
 * @param {Object} cfg - Active profile configuration
 */

_app.checkPlugins = function (cfg: GeoLeafConfig) {
    const AppLog = _app.AppLog;

    // Warning if config expects Storage but plugin is not loaded.
    // Plugin config lives under modules.<id> (Plugin Contract v1, INV-CONFIG).
    const storageConfig = cfg?.modules?.storage;
    if (storageConfig) {
        if (!GeoLeaf.Storage) {
            AppLog.warn(
                "⚠️ Config references storage but Storage plugin is not loaded. " +
                    "Advanced features (IndexedDB, CacheManager, sync) require geoleaf-offline-ui.plugin.js. " +
                    "Basic offline caching via SW core is always available without the plugin."
            );
        }

        // ⚠️ UNE SECONDE GARDE VIVAIT ICI, sur `storageConfig.enableServiceWorker` — retirée
        // à la tâche 3.13. Elle ne s'est JAMAIS déclenchée : `grep -rl enableServiceWorker
        // profiles/` rend 0, aucun profil ne pose la clé. Et son message était faux deux fois
        // — il citait un `sw.js` qui n'existe plus, et promettait un « background sync » que
        // le worker n'a jamais eu (aucun `registration.sync.register` dans le dépôt, et le
        // chemin est retiré par cette même tâche).
    }

    // 5.1-f — la garde `ui.showAddPoi && !GeoLeaf.AddPOI` est retirée avec le drapeau
    // qu'elle lisait. Elle conseillait d'inclure `geoleaf-addpoi.plugin.js`, un fichier qui
    // n'existe plus ; et le bouton qu'elle couvrait passe par un créneau paresseux, dont
    // l'absence de plugin est un état NORMAL jusqu'au premier clic.
};

// ============================================================
// Helper : display une notification
// ============================================================
/**
 * Displays a user-facing notification via the notify primitive.
 * Always succeeds: buffers the message before the renderer is ready, then
 * forwards it when the toast system registers via `notifyPrimitive.registerRenderer()`.
 * @param {string} message - Message to display.
 * @returns {boolean} Always `true` — the primitive guarantees delivery.
 */
_app.showNotification = function (message: string) {
    notifyPrimitive.notify(message, "success");
    return true;
};

// `_app._ensureModule` (Sprint 6 lazy-loading helper) was removed in S5 along with the rest of
// the lazy machinery. It had zero production callers, and the chunk names its tests passed
// ("poi", "route") had been deleted two sprints earlier.

export { _app };
