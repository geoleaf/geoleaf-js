/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoJSONModule — `ICoreModule` wrapper for the GeoJSON subsystem.
 *
 * Represents: `GeoLeaf.GeoJSON` (layers, styles, clustering, workers).
 * Underlying globals: `globals.geojson.ts` (B5) — full bundle.
 *                     `globals.geojson-lite.ts` (B5) — lite bundle.
 *
 * Stub wrapper — initialization already performed as a side-effect
 * of the `globals.ts` import in the bundle entry point.
 */

import type { ILifecycleModule } from "../../contracts/core-module.contract.ts";
import type { IMapAdapter } from "../../contracts/map-adapter.contract.ts";
import type { IGeoLeafConfig } from "../../contracts/config.contract.ts";
import { GeoJSONShared } from "../../kernel/geojson/shared.js";
import { ensureGeoLeaf } from "../../utils/general/geoleaf-global.js";
import { asFn, type AppNamespace } from "../app-types.js";
import { asObject } from "../../utils/general/type-guards.js";

/**
 * Represents the GeoJSON rendering subsystem (layers, styles, clustering,
 * web workers, and route in the full bundle). Depends on `config` and
 * `core-map` to ensure the Config singleton and utilities are ready.
 */
export class GeoJSONModule implements ILifecycleModule {
    readonly id = "geojson" as const;
    readonly dependencies = ["config", "core-map"] as const;

    async init(adapter: IMapAdapter, _config: IGeoLeafConfig): Promise<void> {
        // (Phase A posts the GeoJSON facades and the loader wiring at import —
        // `globals.geojson.ts`. What follows needs the map, so it stays here. `_config` is
        // unused: the profile is read from `GeoLeaf.Config` below, not from the argument —
        // the only reader of this parameter was the `runModuleSetup` threading, now gone.)

        // F0 (S8): bind the map and load the profile's layers HERE, moved out of the
        // UI phase (`initGeoJSON`, init-features.ts). Because the registry awaits
        // each module's init() in topological order and `geojson` precedes `ui`, awaiting
        // the load leaves the layer registry HOT before UIModule's theme applier runs →
        // `_applyLayerConfig` takes the TOGGLE branch, never ADD (no double load).
        const GeoLeaf = ensureGeoLeaf();
        const _app = (GeoLeaf._app ?? {}) as AppNamespace;
        const AppLog = _app.AppLog;
        const map = (_app._currentMap ?? adapter) as IMapAdapter;
        const geoJsonApi = asObject(GeoLeaf.GeoJSON);
        const geoJsonInit = asFn(geoJsonApi?.init);
        if (!geoJsonInit) {
            AppLog?.log?.("GeoLeaf.GeoJSON.init() unavailable — no GeoJSON layers.");
            return;
        }
        try {
            geoJsonInit.call(geoJsonApi, { map, fitBoundsOnLoad: false, maxZoomOnFit: 12 });
        } catch (e) {
            AppLog?.warn?.("GeoLeaf.GeoJSON.init() threw an error:", e);
            return;
        }
        // Phase 1 (immediate/default-theme layers) is awaited → hot registry; Phase 2
        // (deferred) stays fire-and-forget inside the loader. Errors are swallowed so a
        // load failure never rejects init() (which would abort the registry chain).
        const loadFromActiveProfile = asFn(geoJsonApi?.loadFromActiveProfile);
        if (!loadFromActiveProfile) return;
        try {
            await loadFromActiveProfile.call(geoJsonApi);
        } catch (e) {
            AppLog?.warn?.("Error loading layers from active profile:", e);
        }
    }

    destroy(): void {
        // Clear the shared GeoJSON state (layers map, id counter, adapter/map references) so a
        // recreate starts with no residual layers. The facades themselves were posted at import
        // and are never removed — nothing to re-arm.
        GeoJSONShared.reset();
    }
}
