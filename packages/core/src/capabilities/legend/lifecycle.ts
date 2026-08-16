/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Legend capability — lifecycle / init wiring (S10, F1).
 *
 * Consolidates the legend init that was previously scattered across two external
 * amorces (`initLegendSafe` in the map factory + a block in `init-deferred-ui`)
 * into a single mount deferred to `geoleaf:app:ready`, mirroring the
 * filter / theme-selector pattern: the listener is registered during the
 * synchronous `registry.init()` and catches the async event.
 *
 * On ready it late-gates on the merged `modules.legend.enabled` (the boot gate is
 * opt-out on the pre-merge baseCfg), then initialises `Legend` with the active map
 * adapter — options are read from `modules.legend` inside `Legend.init` (S10 F2, no
 * hardcoded bag) — and loads the legends of the layers active in the current theme
 * (atomic, `init` first).
 *
 * Invoked by `LegendModule` (registered in `boot.ts` when `modules.legend.enabled`,
 * opt-out). `LegendModule` depends on `geojson` only (NOT `ui`), so it is dequeued
 * BEFORE `ThemeEngineModule` — the dispatcher of `geoleaf:app:ready` on the themed
 * path — and this listener is registered before the event fires.
 */

// B.28 — the IMPLEMENTATION, not the facade. This import used to point at
// `./public-api.js`, which made legend the only capability whose lifecycle depended
// on its own public API instead of the reverse.
import { Legend } from "./legend.js";
import { getAllLayerConfigs } from "../../kernel/shared/index.js";
import { getLegendConfig } from "./config.js";
import { Core } from "../../api/geoleaf.core.js";
import { Log } from "../../utils/log/index.js";
import { getGeoLeaf } from "../../utils/general/geoleaf-global.js";
import { asArray, asObject } from "../../utils/general/type-guards.js";

/** Narrows `unknown` to a callable (local — avoids a `capabilities → app` import). */
function _asFn(value: unknown): ((...args: unknown[]) => unknown) | undefined {
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown) : undefined;
}

let _started = false;

/**
 * Loads the legend of every configured layer via the GeoJSON layer manager's
 * `_loadLayerLegend`. Must run after `Legend.init` so the module's `_map` is set.
 * Relocated verbatim from `init-deferred-ui.ts`.
 *
 * Originally filtered to the layers listed by the active theme, but `ThemeSelector`
 * never exposed a `getActiveTheme()` method (only `getCurrentTheme()`) — that read
 * was always `undefined`, so the filter always fell back to "load everything".
 * The dead theme-filtering branch was removed (roadmap nettoyage, PB-2, 2026-07-15) —
 * behavior is unchanged, this only removes code that could never do anything else.
 */
function _loadActiveThemeLayerLegends(): void {
    const g = asObject(getGeoLeaf());
    const layerManager = asObject(g?._GeoJSONLayerManager);
    const loadLayerLegend = _asFn(layerManager?._loadLayerLegend);
    // API S4.3e — via le BARIL `kernel/shared`, pas en import profond : R.8 interdit à
    // `capabilities/**` d'atteindre `kernel/<dir>/<fichier>` directement.
    const layerConfigs = asArray(getAllLayerConfigs());
    if (!loadLayerLegend || !layerConfigs) return;

    layerConfigs.forEach((config) => {
        const configId = asObject(config)?.id;
        loadLayerLegend.call(layerManager, configId, { config });
    });
}

/** Mounts the legend once the app (map + theme layers) is ready. */
function _onAppReady(): void {
    // Late gate on the merged config: the boot gate is opt-out on the pre-merge
    // baseCfg, so the real on/off decision (modules.legend.enabled) happens here.
    // Read inline off `getLegendConfig()`, like every sibling capability's late gate
    // (B.29 — the `isLegendEnabled()` alias was legend's alone and is resorbed).
    if (getLegendConfig().enabled === false) return;
    // Legend must be initialised before its layer legends are loaded. Options are
    // read from `modules.legend` inside Legend.init (S10 F2 — no hardcoded bag).
    try {
        Legend.init(Core.getMap());
    } catch (e) {
        Log?.warn?.("[Legend] Error during Legend module initialization:", e);
    }
    try {
        _loadActiveThemeLayerLegends();
    } catch (e) {
        Log?.warn?.("[Legend] Error loading initial layer legends:", e);
    }
}

/** Idempotent event wiring for the Legend capability. Safe to call multiple times. */
export const LegendLifecycle = {
    init(): void {
        if (_started || typeof document === "undefined") return;
        _started = true;
        // Deferred to app:ready (map + theme layers ready). The event is async
        // relative to registry.init(), so registering here catches it.
        document.addEventListener("geoleaf:app:ready", _onAppReady, { once: true });
    },

    /** Detaches the listener and tears down the legend (module destroy / test). */
    _reset(): void {
        if (typeof document !== "undefined") {
            document.removeEventListener("geoleaf:app:ready", _onAppReady);
        }
        Legend._reset();
        _started = false;
    },
};
