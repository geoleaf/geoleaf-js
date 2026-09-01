/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf GeoJSON Loader - Profile
 * Orchestrates per-profile loading, batch loading and LayerManager population
 */

import { GeoJSONShared } from "../shared.js";
import { resolveClusteringNormalization } from "./clustering-normalize.js";
import { getLog } from "../../../utils/general/di-accessors.js";
import type {
    GeoJSONLoaderLog,
    ConfigModule,
    GeoJSONState,
    LayerDataConfig,
    LayerStyleEntry,
    LoadedLayerResult,
    LoaderDependencies,
} from "./loader-types.js";
import type { GeoJSONNativeMap } from "../core-types.js";

const getState = () => GeoJSONShared.state;

// ─── Phase 1 batching ─────────────────────────────────────────────────────────
//
// These two bound the default-theme layers, which gate the reveal: `GeoJSONModule.init()`
// awaits this batch loop, and every module sorted after `geojson` waits on it.
//
// 🔻 Raised from 3 to 6 on 07/08/2026. The cap predates HTTP/2 and duplicates a limit
// the browser already enforces per origin; over a multiplexed connection it only serialises
// what the transport would have interleaved. 6 stays a bound — it caps how many large GeoJSON
// bodies are parsed concurrently, which is the real cost here (the heaviest shipped layer is
// ~1,1 Mo raw), not the sockets.
//
// 🛑 The delay is DISARMED, not removed — same idiom as `GEOJSON_TOLERANCE_DEG` in
// `build-deploy.cjs`: the mechanism is kept so a genuinely HTTP/1.1 deployment can restore
// throttling by passing `delayMs`, but nothing in this repo does. It cost a measured 400 ms on
// the reveal path: the active profile's default theme (`environnement`) carries 8 layers, so
// batches of 3 fired the timer TWICE. ⚠️ The roadmap said "6 layers = exactly one timeout" —
// it had read the theme NAMED `defaut`, which is not the theme the profile defaults to.
//
// ⚠️ Both values are declared once and referenced by the call site AND by the signature
// defaults below. They were written out twice before, so changing one left the other behind.
const PHASE1_BATCH_SIZE = 6;
const PHASE1_BATCH_DELAY_MS = 0;

// ─── Phase 10-F service locator ───────────────────────────────────────────────

let _deps: LoaderDependencies | null = null;

/**
 * Injects loader dependencies (Phase 10-F — service locator pattern).
 * Called once at boot by globals.geojson.ts after GeoLeaf modules are registered.
 */
export function setupProfileDeps(deps: LoaderDependencies): void {
    _deps = deps;
}

interface ProfileLike {
    id?: string;
    geojsonLayers?: unknown[];
    geojson?: { layers?: unknown[] };
    layers?: unknown[];
    themes?: {
        config?: { defautTheme?: string };
        defaultTheme?: string;
        themes?: { id: string; layers?: { id: string; visible?: boolean }[] }[];
    };
}

function _getLayersDef(
    profile: ProfileLike,
    Config: ConfigModule,
    Log: GeoJSONLoaderLog
): unknown[] {
    if (Array.isArray(profile.geojsonLayers)) return profile.geojsonLayers;
    if (profile.geojson && Array.isArray(profile.geojson.layers)) return profile.geojson.layers;
    if (Array.isArray(profile.layers)) return profile.layers;
    if (Config.Profile && typeof Config.Profile.getActiveProfileLayersConfig === "function") {
        const lc = Config.Profile?.getActiveProfileLayersConfig();
        if (Array.isArray(lc)) {
            Log.info(
                "[GeoLeaf.GeoJSON] Using modular profile system - " + lc.length + " layers detected"
            );
            return lc;
        }
    }
    return [];
}

function _resolveLayerUrl(
    d: Record<string, unknown>,
    profile: ProfileLike,
    self: typeof Loader
): string | null {
    if (d.url) return d.url as string;
    if (d.dataFile && self._resolveDataFilePath) {
        return self._resolveDataFilePath(
            d.dataFile as string,
            profile,
            (d._layerDirectory as string) || null
        );
    }
    // Remote GeoJSON URL declared via data.dataUrl (WFS, opendata APIs, etc.)
    const layerData = d.data as Record<string, unknown> | undefined;
    if (typeof layerData?.dataUrl === "string") return layerData.dataUrl;
    // Vector tiles — URL lives in data.vectorTiles; return it so the layer is not
    // skipped. shouldUseVectorTiles() re-resolves it from def.data.vectorTiles inside _loadSingleLayer.
    if (layerData?.vectorTiles && typeof layerData.vectorTiles === "object") {
        const vt = layerData.vectorTiles as Record<string, unknown>;
        const vtUrl = vt.tilesUrl as string | undefined;
        if (vtUrl) return vtUrl;
    }
    return null;
}

function _applyVectorTilesConfig(nd: Record<string, unknown>, d: Record<string, unknown>): void {
    if (
        d.data &&
        (d.data as LayerDataConfig).vectorTiles &&
        typeof (d.data as LayerDataConfig).vectorTiles === "object"
    )
        nd.vectorTiles = {
            ...((d.data as LayerDataConfig).vectorTiles as Record<string, unknown>),
        };
    if (d.vectorTiles && typeof d.vectorTiles === "object")
        nd.vectorTiles = { ...(d.vectorTiles as Record<string, unknown>) };
}

function _buildNormalizedDef(
    d: Record<string, unknown>,
    profile: ProfileLike,
    layerUrl: string
): Record<string, unknown> {
    const nd = { ...d, url: layerUrl } as Record<string, unknown>;
    nd._profileId = profile.id;
    nd._layerDirectory = (d._layerDirectory as string) || null;
    const clusteringPatch = resolveClusteringNormalization(d.clustering);
    if (clusteringPatch) Object.assign(nd, clusteringPatch);
    if (d.search && typeof d.search === "object") nd.search = d.search;
    if (d.table && typeof d.table === "object") nd.table = d.table;
    _applyVectorTilesConfig(nd, d);
    return nd;
}

function _registerLayerManager(loadedLayers: unknown[]): void {
    if (loadedLayers.length > 0) {
        _deps?.getLayerManager()?.registerWithLayerManager();
    }
}

function _fitBoundsIfNeeded(
    baseOptions: Record<string, unknown>,
    state: GeoJSONState,
    Log: GeoJSONLoaderLog
): void {
    if (!(baseOptions.fitBoundsOnLoad !== false && state.map && state.layerGroup)) return;
    const layerGroup = state.layerGroup as { getBounds(): { isValid(): boolean } };
    const map = state.map as GeoJSONNativeMap;
    const bounds = layerGroup.getBounds();
    if (!bounds.isValid()) return;
    const fitOptions: { maxZoom?: number } = {};
    if (typeof baseOptions.maxZoomOnFit === "number") fitOptions.maxZoom = baseOptions.maxZoomOnFit;
    map.fitBounds(bounds, fitOptions);
    Log.debug("[GeoLeaf.GeoJSON] Map bounds fitted to GeoJSON layers");
    const onMoveEnd = function () {
        map.off("moveend", onMoveEnd);
        try {
            document.dispatchEvent(
                new CustomEvent("geoleaf:fitbounds:complete", { detail: { bounds } })
            );
        } catch (_e) {
            /* ignore */
        }
    };
    map.on("moveend", onMoveEnd);
}

function _resolveDefaultThemeId(themesData: ProfileLike["themes"]): string | null {
    const cfg = themesData && themesData.config;
    return (cfg && cfg.defautTheme) || themesData?.defaultTheme || null;
}

function _resolveStyleLabels(layer: LayerStyleEntry): { styles: unknown; labels: unknown } {
    return {
        styles: layer.config && layer.config.styles ? layer.config.styles : layer.styles || null,
        labels: layer.config && layer.config.labels ? layer.config.labels : layer.labels || null,
    };
}

function _buildLayerDefParams(
    d: Record<string, unknown>,
    profile: ProfileLike,
    state: GeoJSONState,
    layerUrl: string
): { normalizedDef: Record<string, unknown>; layerId: string; layerLabel: string } {
    const normalizedDef = _buildNormalizedDef(d, profile, layerUrl);
    const layerId = (d.id as string) || "geojson-layer-" + state.layerIdCounter++;
    const layerLabel = (d.label as string) || layerId;
    return { normalizedDef, layerId, layerLabel };
}

/**
 * Renders a layer whose config carries a `plugin` field by delegating to the
 * loader that plugin registered via `GeoLeaf.plugins.registerLayerLoader`.
 * The core stays plugin-agnostic — resolution is by id, not by name.
 */
async function _dispatchPluginLayer(
    d: Record<string, unknown>,
    index: number,
    profile: ProfileLike,
    Log: GeoJSONLoaderLog
): Promise<LoadedLayerResult | null> {
    const pluginId = d.plugin as string;
    // A LAZILY-registered plugin has not yet run its `registerLayerLoader()`, so
    // the synchronous resolution below would yield `undefined` and the layer would
    // be skipped. We give it its chance BEFORE concluding. The core still names no
    // plugin: the registry is what knows whether this id has a resolver.
    await _deps?.ensurePluginLoaded?.(pluginId);
    const loader = _deps?.getPluginLayerLoader?.(pluginId);
    if (!loader) {
        Log.warn(
            `[GeoLeaf.GeoJSON] Layer declares plugin "${pluginId}" but no loader is registered; skipped :`,
            { index, id: d.id }
        );
        return null;
    }
    try {
        const layerId = await loader({ ...d, _profileId: profile.id });
        return { id: layerId, label: (d.label as string) || layerId };
    } catch (err) {
        Log.error("[GeoLeaf.GeoJSON] Plugin layer load failed :", {
            plugin: pluginId,
            id: d.id,
            error: err,
        });
        return null;
    }
}

async function _processLayerDef(
    def: unknown,
    index: number,
    profile: ProfileLike,
    state: GeoJSONState,
    self: typeof Loader,
    baseOptions: Record<string, unknown>,
    Log: GeoJSONLoaderLog
): Promise<unknown> {
    if (!def || typeof def !== "object") {
        Log.warn("[GeoLeaf.GeoJSON] Invalid profile GeoJSON descriptor, ignored :", {
            index,
            def,
        });
        return null;
    }
    const d = def as Record<string, unknown>;
    if (typeof d.active === "boolean" && d.active === false) {
        Log.debug("[GeoLeaf.GeoJSON] Layer disabled (active: false), skipped :", d.id);
        return null;
    }
    // Plugin-backed layer: dispatch to the loader the plugin registered (e.g. flatgeobuf).
    // Generic — the core never references a plugin by name; the lookup is by `plugin` id.
    if (typeof d.plugin === "string" && d.plugin) {
        return _dispatchPluginLayer(d, index, profile, Log);
    }
    const layerUrl = _resolveLayerUrl(d, profile, self);
    if (!layerUrl) {
        Log.warn("[GeoLeaf.GeoJSON] GeoJSON descriptor without URL or dataFile, ignored :", {
            index,
            id: d.id,
            label: d.label,
        });
        return null;
    }
    const params = _buildLayerDefParams(d, profile, state, layerUrl);
    const { normalizedDef, layerId, layerLabel } = params;
    const debugLoad = { profileId: profile.id, layerId, url: layerUrl };
    Log.debug("[GeoLeaf.GeoJSON] Loading GeoJSON layer :", debugLoad);
    try {
        const loadLayer = _deps?.getLoader()?._loadSingleLayer;
        return (await loadLayer?.(layerId, layerLabel, normalizedDef, baseOptions)) ?? null;
    } catch (err) {
        Log.error("[GeoLeaf.GeoJSON] Failed to load layer :", {
            layerId,
            url: layerUrl,
            error: err,
        });
        return null;
    }
}

interface LoaderShape {
    loadFromActiveProfile: (options?: Record<string, unknown>) => Promise<unknown[]>;
    _loadLayersByBatch: (
        tasks: (() => Promise<unknown>)[],
        batchSize?: number,
        delayMs?: number
    ) => Promise<unknown[]>;
    _getDefaultThemeLayerIds: (profile: ProfileLike) => Set<string>;
    _loadLayersInIdle: (
        tasks: (() => Promise<unknown>)[],
        batchSize?: number
    ) => Promise<unknown[]>;
    loadAllLayersConfigsForLayerManager: (profile: ProfileLike) => Promise<unknown[]>;
    _resolveDataFilePath?: (
        dataFile: string,
        profile: ProfileLike,
        layerDirectory: string | null
    ) => string | null;
}

const Loader: LoaderShape = {} as LoaderShape;

function _splitTasksByTheme(
    layersDef: unknown[],
    profile: ProfileLike,
    state: GeoJSONState,
    self: typeof Loader,
    baseOptions: Record<string, unknown>,
    Log: GeoJSONLoaderLog
): { immediateTasks: (() => Promise<unknown>)[]; deferredTasks: (() => Promise<unknown>)[] } {
    const tasks = layersDef.map(
        (def: unknown, index: number) => async () =>
            _processLayerDef(def, index, profile, state, self, baseOptions, Log)
    );
    const defaultThemeLayerIds = self._getDefaultThemeLayerIds(profile);
    // F0 (S8): when a default theme governs the boot, load ONLY its layers (immediate) —
    // the theme decides what shows, byte-identical to the pre-decoupling boot. Non-theme
    // layers are NOT loaded here; they load on demand when the user switches theme (the
    // applier's ADD branch, still present in F0). With NO default theme the kernel shows
    // every declared layer, so all of them load (deferred/batched).
    const hasDefaultTheme = !!_resolveDefaultThemeId(profile.themes);
    const immediateTasks: (() => Promise<unknown>)[] = [];
    const deferredTasks: (() => Promise<unknown>)[] = [];
    layersDef.forEach((def: unknown, index: number) => {
        const task = tasks[index];
        if (!task) return;
        const d = def as { id?: string };
        if (d && d.id && defaultThemeLayerIds.has(d.id)) {
            immediateTasks.push(task);
        } else if (!hasDefaultTheme) {
            deferredTasks.push(task);
        }
        // else (default theme present): non-theme layer skipped at boot — loads on switch.
    });
    return { immediateTasks, deferredTasks };
}

function _scheduleDeferredLayers(
    deferredTasks: (() => Promise<unknown>)[],
    self: typeof Loader,
    state: GeoJSONState,
    Log: GeoJSONLoaderLog
): void {
    self._loadLayersInIdle(deferredTasks)
        .then((loadedDeferred: unknown[]) => {
            const loadedDeferredFiltered = (loadedDeferred as LoadedLayerResult[]).filter(Boolean);
            Log.info(
                "[GeoLeaf.GeoJSON] Phase 2 : " +
                    loadedDeferredFiltered.length +
                    " deferred layer(s) loaded in background"
            );
            _registerLayerManager(loadedDeferredFiltered);
            try {
                (state.map as GeoJSONNativeMap).fire("geoleaf:geojson:deferred-layers-loaded", {
                    count: loadedDeferredFiltered.length,
                    layers: loadedDeferredFiltered.map((l) => ({ id: l.id, label: l.label })),
                });
            } catch (_e) {
                /* ignore */
            }
        })
        .catch((err: unknown) =>
            Log.error("[GeoLeaf.GeoJSON] Error loading deferred layers :", err)
        );
}

function _handlePhase1Loaded(
    loadedLayers: unknown[],
    deferredTasks: (() => Promise<unknown>)[],
    baseOptions: Record<string, unknown>,
    state: GeoJSONState,
    self: typeof Loader,
    Log: GeoJSONLoaderLog
): unknown[] {
    Log.info(
        "[GeoLeaf.GeoJSON] Phase 1 : " + loadedLayers.length + " layer(s) from default theme loaded"
    );
    _registerLayerManager(loadedLayers);
    _fitBoundsIfNeeded(baseOptions, state, Log);
    try {
        (state.map as GeoJSONNativeMap).fire("geoleaf:geojson:layers-loaded", {
            count: loadedLayers.length,
            layers: (loadedLayers as LoadedLayerResult[]).map((l) => ({
                id: l.id,
                label: l.label,
            })),
        });
    } catch (_e) {
        /* ignore */
    }
    try {
        document.dispatchEvent(
            new CustomEvent("geoleaf:layers:initial-loaded", {
                detail: { count: loadedLayers.length, deferred: deferredTasks.length },
            })
        );
    } catch (_e) {
        /* ignore */
    }
    if (deferredTasks.length > 0) _scheduleDeferredLayers(deferredTasks, self, state, Log);
    return loadedLayers;
}

function _warnLayerCount(layersDef: unknown[], Log: GeoJSONLoaderLog): void {
    if (layersDef.length > 50)
        Log.warn(
            "[GeoLeaf.GeoJSON] Many GeoJSON layers detected (" +
                layersDef.length +
                "). This may impact performance."
        );
    else if (layersDef.length > 20)
        Log.info(
            "[GeoLeaf.GeoJSON] " +
                layersDef.length +
                " GeoJSON layers detected. Rich profile detected."
        );
}

Loader.loadFromActiveProfile = function (
    options: Record<string, unknown> = {}
): Promise<unknown[]> {
    const state = getState();
    const Log = getLog();
    const Config = _deps?.getConfig();
    if (!Config || typeof Config.getActiveProfile !== "function") {
        Log.warn(
            "[GeoLeaf.GeoJSON] Config module or Config.getActiveProfile() not available; GeoJSON profile loading impossible."
        );
        return Promise.resolve([]);
    }
    const profile = Config.getActiveProfile() as ProfileLike | null;
    if (!profile || typeof profile !== "object") {
        Log.warn("[GeoLeaf.GeoJSON] No active profile or invalid profile; no GeoJSON loaded.");
        return Promise.resolve([]);
    }
    const layersDef = _getLayersDef(profile, Config, Log);
    if (!layersDef.length) {
        Log.info(
            "[GeoLeaf.GeoJSON] No geojsonLayers / geojson.layers / layers block defined in active profile; nothing to load."
        );
        return Promise.resolve([]);
    }
    _warnLayerCount(layersDef, Log);
    const baseOptions = options || {};
    const batchSize = PHASE1_BATCH_SIZE;
    const batchDelay = PHASE1_BATCH_DELAY_MS;
    const self = this;
    const { immediateTasks, deferredTasks } = _splitTasksByTheme(
        layersDef,
        profile,
        state,
        self,
        baseOptions,
        Log
    );
    Log.info(
        `[GeoLeaf.GeoJSON] Smart loading: ${immediateTasks.length} immediate(s) (default theme), ${deferredTasks.length} deferred`
    );
    const handleLoaded = (layers: unknown[]) =>
        _handlePhase1Loaded(layers.filter(Boolean), deferredTasks, baseOptions, state, self, Log);
    return self._loadLayersByBatch(immediateTasks, batchSize, batchDelay).then(handleLoaded);
};

Loader._loadLayersByBatch = async function (
    tasks: (() => Promise<unknown>)[],
    batchSize = PHASE1_BATCH_SIZE,
    delayMs = PHASE1_BATCH_DELAY_MS
): Promise<unknown[]> {
    const results: unknown[] = [];
    const Log = getLog();
    for (let i = 0; i < tasks.length; i += batchSize) {
        const batch = tasks.slice(i, i + batchSize);
        const batchStart = Date.now();
        const batchResults = await Promise.all(batch.map((fn) => fn()));
        results.push(...batchResults);
        Log.info(
            `[GeoLeaf.GeoJSON] Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(tasks.length / batchSize)} loaded in ${Date.now() - batchStart} ms`
        );
        if (i + batchSize < tasks.length && delayMs > 0)
            await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return results;
};

Loader._getDefaultThemeLayerIds = function (profile: ProfileLike): Set<string> {
    try {
        if (!profile || !profile.themes) return new Set();
        const themesData = profile.themes;
        const defaultThemeId = _resolveDefaultThemeId(themesData);
        if (!defaultThemeId || !Array.isArray(themesData.themes)) return new Set();
        const defaultTheme = themesData.themes.find((t: { id: string }) => t.id === defaultThemeId);
        if (!defaultTheme || !Array.isArray(defaultTheme.layers)) return new Set();
        return new Set(
            defaultTheme.layers
                .filter((l: { visible?: boolean }) => l.visible !== false)
                .map((l: { id: string }) => l.id)
        );
    } catch (_e) {
        return new Set();
    }
};

Loader._loadLayersInIdle = function (
    tasks: (() => Promise<unknown>)[],
    batchSize = 2
): Promise<unknown[]> {
    const Log = getLog();
    return new Promise((resolve, reject) => {
        const results: unknown[] = [];
        let index = 0;
        const schedule =
            typeof requestIdleCallback === "function"
                ? (cb: () => void) => requestIdleCallback(cb, { timeout: 3000 })
                : (cb: () => void) => setTimeout(cb, 60);
        const processNext = () => {
            if (index >= tasks.length) {
                resolve(results);
                return;
            }
            const runBatch = async () => {
                const batch = tasks.slice(index, index + batchSize);
                const batchResults = await Promise.all(batch.map((fn) => fn()));
                results.push(...batchResults);
                Log.debug(
                    `[GeoLeaf.GeoJSON] Idle: batch ${Math.floor(index / batchSize) + 1}/${Math.ceil(tasks.length / batchSize)} (${results.length}/${tasks.length} processed)`
                );
                index += batchSize;
                processNext();
            };
            // `schedule` takes a `() => void` (requestIdleCallback / setTimeout), so the
            // async body needs a sync wrapper. The rejection MUST be forwarded: the
            // executor had no `reject`, so a failing batch left this promise pending
            // for ever — a silent hang, not an error.
            schedule(() => {
                runBatch().catch(reject);
            });
        };
        processNext();
    });
};

Loader.loadAllLayersConfigsForLayerManager = async function (
    profile: ProfileLike
): Promise<unknown[]> {
    const Log = getLog();
    if (!profile || !profile.layers || !Array.isArray(profile.layers)) {
        Log.warn("[GeoLeaf.GeoJSON] loadAllLayersConfigsForLayerManager: No layers in profile");
        return [];
    }
    const layers = profile.layers as {
        id: string;
        label?: string;
        layerManagerId?: string;
        configFile?: string;
        geometry?: string;
        geometryType?: string;
        config?: {
            zIndex?: number;
            themes?: unknown;
            geometry?: string;
            geometryType?: string;
            styles?: unknown;
            labels?: unknown;
        };
        styles?: unknown;
        labels?: unknown;
    }[];
    Log.info(
        `[GeoLeaf.GeoJSON] Preparing ${layers.length} layer configurations for LayerManager...`
    );
    const allConfigs = layers.map((layer) => {
        const { styles, labels } = _resolveStyleLabels(layer);
        return {
            id: layer.id,
            label: layer.label,
            layerManagerId: layer.layerManagerId || "geojson-default",
            configFile: layer.configFile,
            zIndex: (layer.config && layer.config.zIndex) || 0,
            themes: (layer.config && layer.config.themes) || null,
            // Carry the geometry through so the legend resolves the right symbol
            // (line / polygon) instead of falling back to a point/circle. At runtime
            // (bundled profile) geometry lives directly on the layer; some paths nest
            // it under `config` — read both.
            geometry: layer.geometry ?? (layer.config && layer.config.geometry),
            geometryType: layer.geometryType ?? (layer.config && layer.config.geometryType),
            styles,
            labels,
        };
    });
    Log.info("[GeoLeaf.GeoJSON] " + allConfigs.length + " configurations ready for LayerManager");
    _deps?.setAllLayerConfigs(allConfigs);
    return allConfigs;
};

export { Loader as LoaderProfile };
