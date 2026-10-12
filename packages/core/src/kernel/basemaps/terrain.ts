/*!
 * GeoLeaf Core – Basemaps / Terrain
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 *
 * Manages 3D terrain rendering via MapLibre GL JS native API:
 *   - raster-dem source ("terrain-dem")
 *   - map.setTerrain() / map.setTerrain(null)
 *   - the camera, in ONE of the two activation modes only
 *
 * Two modes, chosen by `terrain.activation`:
 *   - "basemap" (default): selecting the basemap puts the terrain on when it declares
 *     `default3D`, posts the camera to its `pitch` / `bearing` with jumpTo(), and eases it back
 *     flat when the basemap is left.
 *   - "pitch": the terrain follows the tilt of the camera — absent while the map is flat, put on
 *     once the camera comes to rest tilted past a threshold, removed once it comes to rest under
 *     a lower one. The camera is NEVER moved in this mode.
 *
 * In BOTH modes the map is what says whether a terrain is on: the engine resets it without a
 * word when it rebuilds a style that does not declare it, and each mode listens to `style.load`
 * to put its own back. Neither moves the camera then.
 *
 * CRITICAL ordering rule:
 *   setTerrain(null) MUST precede removeSource("terrain-dem").
 *   A basemap LEFT in the "basemap" mode has its source removed at map.once("render"), as it
 *   has always been. Everywhere else — the "pitch" mode, and a source replaced because the
 *   incoming basemap asks for another elevation — the removal is immediate: read in MapLibre
 *   6.7.0, `Style.removeSource` holds no guard for a source the terrain used, and the order is
 *   the whole invariant.
 * https://geoleaf.dev
 */

import { Log } from "../../utils/log/index.js";
import type { TerrainConfig } from "../config/geoleaf-config/config-types.js";
import type {
    BasemapDefinition,
    NativeMap,
    NativeMapErrorEvent,
    NativeSourceView,
} from "./basemaps-types.js";

// ─── Fixed IDs ───────────────────────────────────────────────────────────────

/** MapLibre source id used for raster-dem terrain. */
const TERRAIN_SOURCE_ID = "terrain-dem";

/** Tilt, in degrees, from which a terrain that follows the tilt is put on by default. */
const DEFAULT_ACTIVATE_FROM_PITCH = 12;

/** Ceiling of the engine's camera tilt, in degrees. */
const MAX_PITCH = 85;

// ─── State ───────────────────────────────────────────────────────────────────

/**
 * What a basemap whose terrain is put on by its selection holds on its map while it is the
 * active one. Whether the terrain is on is NOT kept here: it is read back from the map.
 */
interface SelectionBinding {
    map: NativeMap;
    key: string;
    config: TerrainConfig;
}

/** The binding of the active basemap, when its terrain was put on by its selection. */
let _selected: SelectionBinding | null = null;

/**
 * Ownership counter of the `terrain-dem` source: it moves each time the source is claimed or
 * released. A removal deferred to the next frame keeps the value it was armed with, and gives
 * up when the counter has moved — the source belongs to someone else by then.
 */
let _demEpoch = 0;

/**
 * What a basemap whose terrain follows the tilt holds on its map while it is the active one.
 *
 * `wanted` is the hysteresis latch, and the ONLY thing remembered about the terrain itself:
 * whether it is on is always read back from the map (`getTerrain()`), which the engine resets
 * without a word whenever it rebuilds a style. The latch cannot be read there: between the two
 * thresholds, a map just reset no longer says whether its terrain was wanted.
 */
interface PitchBinding {
    map: NativeMap;
    key: string;
    config: TerrainConfig;
    activateFrom: number;
    deactivateBelow: number;
    /** `null` until the first evaluation. */
    wanted: boolean | null;
    /** A write was refused: none is tried again before the style is in place. */
    blocked: boolean;
    /** Listeners on the map. False while a style swap is in flight. */
    attached: boolean;
}

/** The binding of the active basemap, when its terrain follows the tilt. */
let _pitch: PitchBinding | null = null;

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
 * Returns whether a terrain put on by the SELECTION of its basemap is currently on its map.
 *
 * Read on the map, `map.getTerrain()`: a terrain the engine reset, or one taken off behind this
 * module's back, is not reported as active. A terrain that follows the tilt is not counted here.
 */
export function isTerrainActive(): boolean {
    return _selected !== null && !!_selected.map.getTerrain();
}

/**
 * Returns the key of the basemap whose terrain, put on by its selection, is currently on its
 * map. Returns null when {@link isTerrainActive} is false.
 */
export function getActiveTerrainBasemapKey(): string | null {
    return _selected !== null && isTerrainActive() ? _selected.key : null;
}

/** The raster-dem source a terrain config asks for. */
function _demSpec(config: TerrainConfig): Record<string, unknown> {
    return {
        type: "raster-dem",
        tiles: [config.demUrl],
        encoding: config.demEncoding ?? "terrarium",
        tileSize: 256,
        maxzoom: config.demMaxZoom ?? 15,
    };
}

/**
 * Writes the terrain `config` asks for, unless the map already holds this very one: a redundant
 * `setTerrain` makes the engine throw its terrain mesh away and build it again.
 *
 * @returns True when something was written.
 */
function _writeTerrain(map: NativeMap, config: TerrainConfig): boolean {
    const exaggeration = config.exaggeration ?? 1.5;
    const live = map.getTerrain();
    if (live?.source === TERRAIN_SOURCE_ID && live.exaggeration === exaggeration) return false;
    map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration });
    return true;
}

/**
 * Puts the source and the terrain of `binding` on its map — and nothing else: the camera is
 * posted by the selection of a basemap, never by what puts its terrain back.
 *
 * @returns False when another source holds the id and the engine refused to let it go.
 */
function _poseSelected(binding: SelectionBinding): boolean {
    if (!_ensureDemSource(binding.map, binding.config)) {
        Log.warn(
            `[TerrainManager] basemap "${binding.key}": the "${TERRAIN_SOURCE_ID}" source is held by` +
                ` a layer and could not be replaced. The terrain is not put on.`
        );
        return false;
    }
    _writeTerrain(binding.map, binding.config);
    return true;
}

/**
 * A style is in place on the map of a terrain put on by selection. The engine dropped the
 * terrain if the style it rebuilt does not declare it, and kept it otherwise — a style replayed
 * as it was, a restored context: the map is read again, and written only if it lost something.
 */
function _onSelectedStyleLoad(): void {
    const binding = _selected;
    if (!binding) return;
    try {
        if (binding.map.getTerrain() && binding.map.getSource(TERRAIN_SOURCE_ID)) return;
        if (_poseSelected(binding)) {
            Log.info("[TerrainManager] Terrain 3D put back on a rebuilt style:", binding.key);
        }
    } catch (err) {
        Log.warn("[TerrainManager] Could not put the terrain back on the rebuilt style:", err);
    }
}

/** Drops the binding of a terrain put on by selection, and its listeners. Writes nothing. */
function _forgetSelected(): void {
    const binding = _selected;
    _selected = null;
    if (!binding) return;
    binding.map.off("error", _onTerrainError);
    binding.map.off("style.load", _onSelectedStyleLoad);
}

/**
 * Puts the source and the terrain of a basemap on the map, posts the camera, and binds the
 * basemap to its map. Separated from `activateTerrain` to keep per-function size under limit.
 * @internal
 */
function _applyTerrainToMap(map: NativeMap, config: TerrainConfig, basemapKey: string): void {
    const pitch = config.pitch ?? 45;
    const bearing = config.bearing ?? 0;

    // An activation that was never undone leaves nothing behind: its listeners first.
    _forgetSelected();
    // The source is compared, not merely looked for: one of that id may be there still — left by
    // the previous basemap, whose removal waits for the next frame — and read another elevation.
    const binding: SelectionBinding = { map, key: basemapKey, config };
    if (!_poseSelected(binding)) return;
    // 🛑 POSTED INSTANTLY, NOT ANIMATED — an animated tilt gets CUT, and it was. `easeTo` is
    // cancelled by any later camera command, and the application posts one at reveal
    // (`app/init-reveal.ts` re-frames the profile bounds as the veil lifts — some 120 ms after it,
    // when this was measured). Measured
    // on a plain boot with nothing acting on the page, basemap asking for `pitch: 60`:
    //
    //     618 fitBounds  →  629 easeTo{60}   final 60 ✅  — the tilt came last
    //     471 easeTo{60} →  528 fitBounds    final 0–9 ❌ — the tilt was cut mid-flight
    //
    // The order is a race and it came out wrong five times in six: the "Relief 3D" basemap the
    // user picked stayed essentially flat, terrain on, nothing logged. A camera posted instantly
    // has nothing to cut, and at boot it sits behind the veil — there is no visible jump traded
    // away. ⚠️ Nor does preserving the CURRENT angle in the re-framing fix this on its own: a
    // camera mid-animation reads 0.024°, and preserving that freezes the transient.
    map.jumpTo({ pitch, bearing });

    // Listen for DEM tile loading errors (CORS, 404, rate-limiting, etc.).
    // Without this, raster-dem failures are silently swallowed by MapLibre.
    map.on("error", _onTerrainError);
    // The engine drops the terrain of a style it rebuilds without it: put back from there.
    map.on("style.load", _onSelectedStyleLoad);

    _selected = binding;
    Log.info("[TerrainManager] Terrain 3D activated for basemap:", basemapKey, {
        exaggeration: config.exaggeration ?? 1.5,
        pitch,
        bearing,
    });
}

/**
 * Activates 3D terrain rendering for a given basemap config — the terrain of the `"basemap"`
 * activation mode, put on by the selection of its basemap.
 *
 * - Makes `terrain-dem` the `raster-dem` source the config asks for: kept when the one in place
 *   is the very same, replaced when it reads another elevation.
 * - Calls `map.setTerrain()` with the configured source and exaggeration.
 * - Posts the configured pitch and bearing at once, via `map.jumpTo()`.
 * - Listens to `style.load`: a terrain the engine dropped with a style it rebuilt is put back,
 *   the camera left where it is.
 *
 * When a layer still reads a `terrain-dem` source of another elevation, the engine refuses to
 * let it go: a warning is logged, and neither the terrain nor the camera is touched.
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
 * Deactivates 3D terrain rendering — the terrain of the `"basemap"` activation mode.
 *
 * - Calls `map.setTerrain(null)` to detach the terrain.
 * - Defers `removeSource("terrain-dem")` via `map.once("render")` to avoid
 *   MapLibre errors when the source is still referenced by the render pipeline. The removal is
 *   given up when the source has been claimed again by then, and a removal the engine refuses —
 *   a layer still reads the source — is logged as such, the source left in place.
 * - Resets pitch and bearing to 0 via `map.easeTo()`.
 * - Stops listening to the map: nothing puts this terrain back afterwards.
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

        // Stop listening for DEM errors and for rebuilt styles, and mark inactive immediately,
        // before the removal is armed: the callback may fire synchronously (e.g. in tests).
        const bound = _selected?.map;
        _forgetSelected();
        if (bound !== map) {
            // No binding, or one made on another map: this one is cleared all the same.
            map.off("error", _onTerrainError);
            map.off("style.load", _onSelectedStyleLoad);
        }

        map.easeTo({ pitch: 0, bearing: 0 });

        // Defer source removal until after the next render frame. The epoch says whether the
        // source is still nobody's by then: the binding could not, a basemap whose terrain
        // follows the tilt claims the source without ever holding one.
        const armedAt = ++_demEpoch;
        map.once("render", () => {
            if (armedAt !== _demEpoch) return; // the source was claimed again before this frame
            try {
                if (!map.getSource?.(TERRAIN_SOURCE_ID)) return;
                map.removeSource(TERRAIN_SOURCE_ID);
                // A refusal is an `error` event, not an exception: only reading back tells.
                if (map.getSource(TERRAIN_SOURCE_ID)) {
                    Log.warn(
                        `[TerrainManager] The "${TERRAIN_SOURCE_ID}" source is still read by a` +
                            ` layer: left in place.`
                    );
                    return;
                }
                Log.debug("[TerrainManager] raster-dem source removed.");
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

// ─── Terrain that follows the tilt ───────────────────────────────────────────

/** True for a finite tilt the engine can reach, above zero. */
function _isActivationPitch(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= MAX_PITCH;
}

/**
 * The two thresholds of a terrain that follows the tilt. Each key falls back to its own default
 * when it is absent or cannot be honoured — never to the other one: one threshold for both would
 * put the terrain on and off between two movements that end around it.
 */
function _pitchThresholds(config: TerrainConfig): {
    activateFrom: number;
    deactivateBelow: number;
} {
    const activateFrom = _isActivationPitch(config.activateFromPitch)
        ? config.activateFromPitch
        : DEFAULT_ACTIVATE_FROM_PITCH;
    const below = config.deactivateBelowPitch;
    const honoured =
        typeof below === "number" && Number.isFinite(below) && below >= 0 && below < activateFrom;
    return { activateFrom, deactivateBelow: honoured ? below : activateFrom / 2 };
}

/** Names what a terrain that follows the tilt declares and does not read. */
function _warnPitchConfig(config: TerrainConfig, key: string): void {
    const roleless = [
        config.pitch !== undefined ? "pitch" : null,
        config.bearing !== undefined ? "bearing" : null,
        config.default3D === true ? "default3D" : null,
    ].filter((name): name is string => name !== null);
    if (roleless.length > 0) {
        Log.warn(
            `[TerrainManager] basemap "${key}": terrain.activation is "pitch", so terrain.` +
                `${roleless.join(", terrain.")} is not read — the camera is never moved in this mode.`
        );
    }

    const { activateFrom, deactivateBelow } = _pitchThresholds(config);
    if (config.activateFromPitch !== undefined && config.activateFromPitch !== activateFrom) {
        Log.error(
            `[TerrainManager] basemap "${key}": terrain.activateFromPitch must be a tilt above 0 and` +
                ` at most ${MAX_PITCH}. Falling back to ${activateFrom}.`
        );
    }
    if (
        config.deactivateBelowPitch !== undefined &&
        config.deactivateBelowPitch !== deactivateBelow
    ) {
        Log.error(
            `[TerrainManager] basemap "${key}": terrain.deactivateBelowPitch must be lower than` +
                ` terrain.activateFromPitch (${activateFrom}). Falling back to ${deactivateBelow}.`
        );
    }
}

/**
 * Says, once, what is wrong with the terrain a basemap declares. Called when the basemap is
 * registered: a profile is told at boot, not at the first tilt.
 *
 * - `terrain.enabled` without `terrain.demUrl`: an error, and the terrain is never drawn.
 * - `activation: "pitch"` with `pitch`, `bearing` or `default3D: true`: a warning — they describe
 *   the activation by selection, and are not read.
 * - A threshold that cannot be honoured: an error, naming the value used instead.
 * - A threshold without `activation: "pitch"`: a warning — it is not read.
 *
 * @param definition - The basemap definition being registered.
 * @param key - Its key, for the log messages.
 */
export function validateTerrainConfig(definition: BasemapDefinition, key: string): void {
    const config = resolveTerrainConfig(definition, key);
    if (!config) return;

    const activation: unknown = config.activation;
    if (activation === "pitch") {
        _warnPitchConfig(config, key);
        return;
    }
    if (activation !== undefined && activation !== "basemap") {
        Log.warn(
            `[TerrainManager] basemap "${key}": terrain.activation is neither "basemap" nor "pitch".` +
                ` Read as "basemap".`
        );
    }
    if (config.activateFromPitch !== undefined || config.deactivateBelowPitch !== undefined) {
        Log.warn(
            `[TerrainManager] basemap "${key}": terrain.activateFromPitch and` +
                ` terrain.deactivateBelowPitch are read only with terrain.activation: "pitch".`
        );
    }
}

/** How the terrain of a basemap gets put on: by its selection, by the tilt, or not at all. */
function _terrainMode(config: TerrainConfig | null): "basemap" | "pitch" | "none" {
    if (!config) return "none";
    if (config.activation === "pitch") return "pitch";
    return config.default3D ? "basemap" : "none";
}

/** True when the live source already is the one `wanted` describes. */
function _sameDem(live: NativeSourceView, wanted: Record<string, unknown>): boolean {
    // `serialize()` gives back the spec the source was added with; `tiles`, read on the source
    // itself, is only there once the engine has loaded it.
    const spec = typeof live.serialize === "function" ? live.serialize() : live;
    const tiles: unknown = spec.tiles;
    const url: unknown = Array.isArray(tiles) ? tiles[0] : undefined;
    return (
        url === (wanted.tiles as unknown[])[0] &&
        (spec.encoding ?? "terrarium") === wanted.encoding &&
        (spec.maxzoom ?? 15) === wanted.maxzoom
    );
}

/**
 * Makes `terrain-dem` the source `config` asks for, and claims it.
 *
 * A source of that id may still be there from the basemap that was just left — its removal is
 * deferred to the next frame. Kept when it is the very one asked for; replaced otherwise, the
 * terrain off first.
 *
 * @returns False when another source holds the id and the engine refused to let it go — a
 *   layer still reads it.
 */
function _ensureDemSource(map: NativeMap, config: TerrainConfig): boolean {
    const wanted = _demSpec(config);
    const live = map.getSource(TERRAIN_SOURCE_ID);
    if (live && !_sameDem(live, wanted)) {
        if (map.getTerrain()) map.setTerrain(null);
        map.removeSource(TERRAIN_SOURCE_ID);
        // A refusal is an `error` event, not an exception: only reading back tells.
        if (map.getSource(TERRAIN_SOURCE_ID)) return false;
    }
    if (!map.getSource(TERRAIN_SOURCE_ID)) {
        map.addSource(TERRAIN_SOURCE_ID, wanted);
        Log.debug("[TerrainManager] raster-dem source added:", config.demUrl);
    }
    _demEpoch++;
    return true;
}

/** Puts the terrain on, unless the map already holds this very one. */
function _pose(binding: PitchBinding): void {
    const { map, config } = binding;
    if (!_ensureDemSource(map, config)) {
        binding.blocked = true;
        Log.warn(
            `[TerrainManager] basemap "${binding.key}": the "${TERRAIN_SOURCE_ID}" source is held by` +
                ` a layer and could not be replaced. The terrain is not put on.`
        );
        return;
    }
    if (!_writeTerrain(map, config)) return;
    if (!map.getTerrain()) {
        // Refused by the engine's validation: no exception, no effect.
        binding.blocked = true;
        Log.warn(`[TerrainManager] basemap "${binding.key}": the engine refused the terrain.`);
        return;
    }
    Log.info("[TerrainManager] Terrain 3D put on by the tilt, basemap:", binding.key);
}

/** Takes the terrain off. The source stays declared: read by nothing, it requests no tile. */
function _retire(binding: PitchBinding): void {
    if (!binding.map.getTerrain()) return;
    binding.map.setTerrain(null);
    Log.info("[TerrainManager] Terrain 3D removed by the tilt, basemap:", binding.key);
}

/**
 * Brings the map in line with the tilt: moves the latch, then puts the terrain on or takes it
 * off if the map does not already say so. Idempotent — and that is what lets it run on every
 * `moveend`, pans and zooms included.
 *
 * 🛑 CALLED AT REST ONLY. While a terrain is on, the engine keeps a copy of the camera for as
 * long as a movement lasts, and drops it at `moveend`: a terrain removed then put back inside
 * ONE movement resumes from that stale copy, and the camera jumps back. An animation that
 * started without a terrain and gets one mid-flight interpolates towards an elevation prepared
 * by an earlier one. Read in MapLibre 6.7.0 (`Camera.getTransformForUpdate`,
 * `Camera._updateElevation`); nothing written between two movements can meet either.
 */
function _reconcile(): void {
    const binding = _pitch;
    if (!binding?.attached) return;
    try {
        const pitch = binding.map.getPitch();
        if (pitch >= binding.activateFrom) binding.wanted = true;
        else if (pitch < binding.deactivateBelow) binding.wanted = false;
        else binding.wanted ??= false;

        if (binding.blocked) return;
        if (binding.wanted) _pose(binding);
        else _retire(binding);
    } catch (err) {
        // The engine refuses a terrain while it replaces a style. Nothing is lost: the latch is
        // set, and `style.load` lifts the block and reconciles again.
        binding.blocked = true;
        Log.debug("[TerrainManager] Terrain write refused, replayed on style.load:", err);
    }
}

function _onMoveEnd(): void {
    _reconcile();
}

/**
 * A style is in place. The engine reset the terrain if it rebuilt the style, and put it back
 * itself if it restored a lost context: the map is read again, whichever happened.
 */
function _onStyleLoad(): void {
    const binding = _pitch;
    if (!binding?.attached) return;
    binding.blocked = false;
    if (!binding.map.isMoving?.()) _reconcile();
}

/**
 * The WebGL context is gone, and the map's style with it: a source added now would land in an
 * empty style the engine creates on the spot. Nothing is written until `style.load`.
 */
function _onContextLost(): void {
    if (_pitch?.attached) _pitch.blocked = true;
}

function _onMapRemoved(): void {
    _forgetPitch();
}

function _attach(binding: PitchBinding): void {
    const { map } = binding;
    map.on("moveend", _onMoveEnd);
    map.on("style.load", _onStyleLoad);
    map.on("webglcontextlost", _onContextLost);
    map.on("remove", _onMapRemoved);
    map.on("error", _onTerrainError);
    binding.attached = true;
}

function _detach(binding: PitchBinding): void {
    if (!binding.attached) return;
    const { map } = binding;
    map.off("moveend", _onMoveEnd);
    map.off("style.load", _onStyleLoad);
    map.off("webglcontextlost", _onContextLost);
    map.off("remove", _onMapRemoved);
    map.off("error", _onTerrainError);
    binding.attached = false;
}

/** Drops the binding and its listeners. Writes nothing on the map. */
function _forgetPitch(): void {
    const binding = _pitch;
    _pitch = null;
    if (binding) _detach(binding);
}

/**
 * The active basemap no longer follows the tilt: listeners off first — nothing may put the
 * terrain back —, then the terrain, then its source. The camera is left where it is: it is the
 * visitor who tilted it, and a basemap switch has no business flattening their view.
 */
function _releasePitch(map: NativeMap): void {
    _forgetPitch();
    try {
        if (map.getTerrain()) map.setTerrain(null);
        if (map.getSource(TERRAIN_SOURCE_ID)) map.removeSource(TERRAIN_SOURCE_ID);
        _demEpoch++;
    } catch (err) {
        Log.warn("[TerrainManager] Could not release the terrain that followed the tilt:", err);
    }
}

/** Binds the tilt to the terrain of `key`, keeping the latch of the basemap it takes over from. */
function _armPitch(map: NativeMap, config: TerrainConfig, key: string): void {
    if (typeof map.getPitch !== "function" || typeof map.getTerrain !== "function") {
        Log.warn("[TerrainManager] follow the tilt: no valid map instance.");
        return;
    }
    const previous = _pitch; // on this very map, or none — `syncTerrainToBasemap` saw to it
    const binding: PitchBinding = {
        map,
        key,
        config,
        ..._pitchThresholds(config),
        wanted: previous?.wanted ?? null,
        blocked: false,
        attached: previous?.attached ?? false,
    };
    _pitch = binding;
    if (!binding.attached) _attach(binding);

    const ceiling = map.getMaxPitch?.();
    if (typeof ceiling === "number" && ceiling < binding.activateFrom) {
        Log.warn(
            `[TerrainManager] basemap "${key}": the map cannot tilt past ${ceiling}°, under` +
                ` terrain.activateFromPitch (${binding.activateFrom}°). The terrain will never show.`
        );
    }
    Log.info("[TerrainManager] Terrain 3D follows the tilt for basemap:", key, {
        activateFrom: binding.activateFrom,
        deactivateBelow: binding.deactivateBelow,
    });
    // A camera already at rest is read now: a basemap applied under a tilted camera gets its
    // terrain at once. A camera on the move — the reveal's re-framing, the flattening of the
    // basemap just left, a gesture — is read when it stops.
    if (!map.isMoving?.()) _reconcile();
}

/** The basemap of `binding` was applied again: what went missing is put back, the camera is not. */
function _refreshSelected(binding: SelectionBinding, config: TerrainConfig): void {
    binding.config = config;
    try {
        _poseSelected(binding);
    } catch (err) {
        Log.error("[TerrainManager] Failed to put the terrain back:", err);
    }
}

/**
 * Brings the terrain in line with the basemap that just became active. Called once the basemap
 * is in place, on every activation path; this is where the activation mode is decided, and
 * nowhere else.
 *
 * - `terrain.activation: "pitch"`: the terrain follows the tilt from now on. When the basemap
 *   it takes over from did too, the binding is handed over in place: a terrain that is on stays
 *   on, with no write when both read the same elevation source at the same `exaggeration`.
 * - `terrain.default3D`: the terrain is put on and the camera posted, as `activateTerrain` does.
 *   The same basemap applied AGAIN on the same map — a refresh — is neither torn down nor
 *   posted again: its source and its terrain are checked, written only if they went missing,
 *   and the camera stays where the visitor left it.
 * - Neither: whatever the previous basemap held is released.
 *
 * Leaving a basemap whose terrain was put on by its selection flattens the camera, as it always
 * did (`deactivateTerrain`). Leaving one whose terrain followed the tilt never moves it.
 *
 * @param map - The native maplibregl.Map instance.
 * @param definition - The definition of the basemap now active.
 * @param key - Its key.
 */
export function syncTerrainToBasemap(
    map: NativeMap | null,
    definition: BasemapDefinition,
    key: string
): void {
    const config = resolveTerrainConfig(definition, key);
    const mode = _terrainMode(config);

    // A binding on another map is that map's business no longer: listeners off, nothing written.
    if (_pitch && _pitch.map !== map) _forgetPitch();
    if (_pitch && map && mode !== "pitch") _releasePitch(map);
    if (_selected && _selected.key !== key) deactivateTerrain(map);

    if (!config || mode === "none") return;
    if (mode === "basemap") {
        if (_selected?.map === map) _refreshSelected(_selected, config);
        else activateTerrain(map, config, key);
        return;
    }
    if (!map) {
        Log.warn("[TerrainManager] follow the tilt: no valid map instance.");
        return;
    }
    _armPitch(map, config, key);
}

/**
 * Takes the terrain off the map before its style is replaced. Called right before `setStyle`.
 *
 * A terrain still on when the engine is asked for a style keeps it from diffing the two: it
 * rebuilds the incoming style from scratch, reloading every source (MapLibre before 6.10).
 *
 * - A terrain put on by the selection of its basemap: `deactivateTerrain`, camera included.
 * - A terrain that follows the tilt: its listeners are detached FIRST — a style given by URL
 *   leaves the outgoing one alive while it downloads, and a tilt would put the terrain back on
 *   it —, then the terrain is cut. The camera is not touched, and the latch is kept:
 *   `syncTerrainToBasemap` hands it to the incoming basemap, or drops it.
 *
 * @param map - The native maplibregl.Map instance.
 */
export function suspendTerrainForStyleSwap(map: NativeMap | null): void {
    if (_selected) deactivateTerrain(map);

    const binding = _pitch;
    if (!binding) return;
    if (binding.map !== map) {
        _forgetPitch();
        return;
    }
    _detach(binding);
    try {
        if (binding.map.getTerrain()) binding.map.setTerrain(null);
    } catch (err) {
        // The outgoing style is already being replaced: the engine resets the terrain itself.
        Log.debug("[TerrainManager] Terrain not cut before the style swap:", err);
    }
}

/**
 * Forgets the relief of a map that goes away. Runs when an application is unmounted, with the
 * basemap registry (`resetBasemapRegistry`).
 *
 * Without it the state survived its map: the next one inherited a relief it never had, and the
 * first basemap applied to it "left" that relief — `deactivateTerrain` eased the camera of a
 * brand-new map to `pitch: 0, bearing: 0`.
 *
 * Writes NOTHING on the map. It is being torn down: neither its terrain nor its camera is ours
 * to settle any more. The listeners of either mode are detached.
 */
export function resetTerrain(): void {
    _forgetPitch();
    _forgetSelected();
    // A source removal still pending on that map is given up.
    _demEpoch++;
}

/** @internal Resets terrain state. Used only in test environments. */
export function _resetTerrainStateForTesting(): void {
    resetTerrain();
}
