/*!
 * GeoLeaf Core – Basemaps / Terrain
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 *
 * Manages 3D terrain rendering via MapLibre GL JS native API:
 *   - raster-dem source ("terrain-dem")
 *   - map.setTerrain() / map.setTerrain(null)
 *   - camera easeTo() for pitch/bearing transitions
 *
 * CRITICAL ordering rule:
 *   setTerrain(null) MUST precede removeSource("terrain-dem").
 *   Source removal is deferred to map.once("render") to avoid MapLibre
 *   throwing when the source is still referenced by the render pipeline.
 * https://geoleaf.dev
 */

import { Log } from "../../utils/log/index.js";
import type { TerrainConfig } from "../config/geoleaf-config/config-types.js";
import type { BasemapDefinition, NativeMap, NativeMapErrorEvent } from "./basemaps-types.js";

// ─── Fixed IDs ───────────────────────────────────────────────────────────────

/** MapLibre source id used for raster-dem terrain. */
const TERRAIN_SOURCE_ID = "terrain-dem";

// ─── State ───────────────────────────────────────────────────────────────────

/** Whether the terrain is currently active on the map. */
let _isActive = false;

/** Key of the basemap whose terrain config is currently applied. */
let _activeBasemapKey: string | null = null;

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Named error handler for the DEM source. Stored as a stable reference
 * so it can be removed on deactivation without leaking listeners.
 */
function _onTerrainError(e: NativeMapErrorEvent): void {
    if (e?.sourceId === TERRAIN_SOURCE_ID) {
        Log.warn("[TerrainManager] DEM tile error:", e.error?.message ?? e.error);
    }
}

/**
 * Returns whether 3D terrain is currently active on the map.
 */
export function isTerrainActive(): boolean {
    return _isActive;
}

/**
 * Returns the key of the basemap whose terrain is currently active.
 * Returns null when terrain is inactive.
 */
export function getActiveTerrainBasemapKey(): string | null {
    return _activeBasemapKey;
}

/**
 * Resolves terrain default values and applies raster-dem source + terrain to the map.
 * Separated from `activateTerrain` to keep per-function size under limit.
 * @internal
 */
function _applyTerrainToMap(map: NativeMap, config: TerrainConfig, basemapKey: string): void {
    const encoding = config.demEncoding ?? "terrarium";
    const exaggeration = config.exaggeration ?? 1.5;
    const pitch = config.pitch ?? 45;
    const bearing = config.bearing ?? 0;
    const tileSize = 256;
    const maxzoom = config.demMaxZoom ?? 15;

    // Add raster-dem source only if not already present (idempotent)
    if (!map.getSource(TERRAIN_SOURCE_ID)) {
        map.addSource(TERRAIN_SOURCE_ID, {
            type: "raster-dem",
            tiles: [config.demUrl],
            encoding,
            tileSize,
            maxzoom,
        });
        Log.debug("[TerrainManager] raster-dem source added:", config.demUrl);
    }

    map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration });
    map.easeTo({ pitch, bearing });

    // Listen for DEM tile loading errors (CORS, 404, rate-limiting, etc.).
    // Without this, raster-dem failures are silently swallowed by MapLibre.
    map.on("error", _onTerrainError);

    _isActive = true;
    _activeBasemapKey = basemapKey;
    Log.info("[TerrainManager] Terrain 3D activated for basemap:", basemapKey, {
        exaggeration,
        pitch,
        bearing,
    });
}

/**
 * Activates 3D terrain rendering for a given basemap config.
 *
 * - Adds a `raster-dem` source named `terrain-dem` (if not already present).
 * - Calls `map.setTerrain()` with the configured source and exaggeration.
 * - Applies the configured pitch and bearing via `map.easeTo()`.
 *
 * @param map - The native maplibregl.Map instance.
 * @param config - The terrain configuration from the basemap definition.
 * @param basemapKey - The key of the basemap this terrain config belongs to.
 */
export function activateTerrain(
    map: NativeMap | null,
    config: TerrainConfig,
    basemapKey: string
): void {
    if (!map || typeof map.getSource !== "function") {
        Log.warn("[TerrainManager] activate: no valid map instance.");
        return;
    }
    if (!config.enabled) {
        Log.warn("[TerrainManager] activate called but terrain.enabled is false.");
        return;
    }
    if (!config.demUrl) {
        Log.warn(
            "[TerrainManager] activate: terrain.demUrl is required but missing for basemap:",
            basemapKey
        );
        return;
    }
    try {
        _applyTerrainToMap(map, config, basemapKey);
    } catch (err) {
        Log.error("[TerrainManager] Failed to activate terrain:", err);
    }
}

/**
 * Deactivates 3D terrain rendering.
 *
 * - Calls `map.setTerrain(null)` to detach the terrain.
 * - Defers `removeSource("terrain-dem")` via `map.once("render")` to avoid
 *   MapLibre errors when the source is still referenced by the render pipeline.
 * - Resets pitch and bearing to 0 via `map.easeTo()`.
 *
 * @param map - The native maplibregl.Map instance.
 */
export function deactivateTerrain(map: NativeMap | null): void {
    if (!map || typeof map.setTerrain !== "function") {
        Log.warn("[TerrainManager] deactivate: no valid map instance.");
        return;
    }

    try {
        // CRITICAL: setTerrain(null) MUST precede removeSource
        map.setTerrain(null);
        Log.debug("[TerrainManager] setTerrain(null) called.");

        // Stop listening for DEM errors
        map.off("error", _onTerrainError);

        map.easeTo({ pitch: 0, bearing: 0 });

        // Mark inactive immediately so the deferred removal guard works
        // even when the callback fires synchronously (e.g. in tests).
        _isActive = false;
        _activeBasemapKey = null;

        // Defer source removal until after the next render frame
        map.once("render", () => {
            if (_isActive) return; // terrain re-activated synchronously before this frame
            try {
                if (map.getSource?.(TERRAIN_SOURCE_ID)) {
                    map.removeSource(TERRAIN_SOURCE_ID);
                    Log.debug("[TerrainManager] raster-dem source removed.");
                }
            } catch (removeErr) {
                Log.warn("[TerrainManager] Could not remove terrain source:", removeErr);
            }
        });

        Log.info("[TerrainManager] Terrain 3D deactivated.");
    } catch (err) {
        Log.error("[TerrainManager] Failed to deactivate terrain:", err);
    }
}

/**
 * Extracts the TerrainConfig from a basemap definition if it is valid and enabled.
 *
 * Performs boot-time validation:
 * - Logs an error if `terrain.enabled` is true but `terrain.demUrl` is missing.
 *
 * @param definition - The basemap config object from the registry.
 * @param key - The basemap key (for log messages).
 * @returns The TerrainConfig if valid and enabled, otherwise null.
 */
export function resolveTerrainConfig(
    definition: BasemapDefinition,
    key: string
): TerrainConfig | null {
    if (!definition?.terrain?.enabled) return null;

    const terrain: TerrainConfig = definition.terrain;

    // Require demUrl when enabled
    if (!terrain.demUrl) {
        Log.error(
            `[TerrainManager] basemap "${key}" has terrain.enabled: true but terrain.demUrl is missing.` +
                ` Terrain will not be activated for this basemap.`
        );
        return null;
    }

    return terrain;
}

/** @internal Resets terrain state. Used only in test environments. */
export function _resetTerrainStateForTesting(): void {
    _isActive = false;
    _activeBasemapKey = null;
}
