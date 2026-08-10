/*!
 * GeoLeaf FlatGeobuf Plugin — API implementation
 * © 2026 Mattieu Pottier — MIT License
 *
 * The 4 entry points behind `GeoLeaf.FlatGeobuf.*` (⚠️ said `GeoLeaf.FGB` until 27/07/2026 —
 * a name mounted nowhere; see the note in `public-api.ts`) — load, loadBbox, loadAsLayer,
 * loadBboxAsLayer — plus the auto-refresh wiring and debounce they share. Split out of
 * `public-api.ts` (backlog B.12): the header claimed each function "delegates to the core
 * loader", but the facade also held the refresh state and the layer-building logic.
 * `public-api.ts` now re-exports from here and carries no logic (INV-FACADE).
 * https://geoleaf.dev
 */
import type {
    FgbBbox,
    FgbLoadOptions,
    FgbBboxOptions,
    FgbLayerOptions,
    FgbLoadResult,
} from "./types.js";
import { loadFgb } from "./fgb-loader.js";
import { loadFgbBbox, setupAutoRefresh } from "./fgb-bbox-filter.js";

// ─── GeoLeaf core accessor ────────────────────────────────────────────────────

/**
 * Shape of the core MapLibre adapter used to render the loaded data.
 * `addGeoJSONLayer` creates a `gl-src-<id>` source + fill/line/circle sub-layers;
 * `updateLayerData` replaces an existing source's data in place (auto-refresh).
 */
interface MapAdapterLike {
    addGeoJSONLayer?(id: string, data: unknown, options?: Record<string, unknown>): void;
    updateLayerData?(id: string, data: unknown): void;
    getNativeMap?(): unknown;
}

interface GeoLeafCore {
    getMap?(): MapAdapterLike | null;
}

interface GeoLeafNS {
    Core?: GeoLeafCore;
}

function _getGeoLeaf(): GeoLeafNS {
    return (globalThis as { GeoLeaf?: GeoLeafNS }).GeoLeaf ?? {};
}

/** Auto-increment used to generate unique layer ids when none is supplied. */
let _layerSeq = 0;

/** Resolves the core map adapter or throws when the map is not initialized. */
function _getAdapter(): MapAdapterLike {
    const adapter = _getGeoLeaf().Core?.getMap?.();
    if (!adapter?.addGeoJSONLayer) {
        throw new Error(
            "[GeoLeaf.FlatGeobuf] Map adapter unavailable. Ensure @geoleaf/core is loaded and the map is initialized."
        );
    }
    return adapter;
}

/**
 * Renders the loaded FeatureCollection on the map through the core adapter.
 *
 * Routes through `adapter.addGeoJSONLayer` (the live MapLibre path) rather than
 * `GeoLeaf.GeoJSON.addData`, which is a no-op in MapLibre mode. The layer is drawn
 * on the map but NOT registered in the layer-manager panel (that registration is
 * core-internal and not reachable from a plugin).
 *
 * @returns The layer ID (auto-generated when `options.layerId` is omitted).
 */
function _addDataToMap(result: FgbLoadResult, options: FgbLayerOptions): string {
    const adapter = _getAdapter();
    const layerId = options.layerId ?? `flatgeobuf-${(_layerSeq += 1)}`;
    adapter.addGeoJSONLayer!(layerId, result.data, {
        layerName: options.layerName,
        visible: options.visible ?? true,
        cluster: options.cluster ?? false,
        geometry: options.geometry,
        zIndex: options.zIndex,
    });
    return layerId;
}

// ─── load ────────────────────────────────────────────────────────────────────

/**
 * Loads a complete FlatGeobuf file from a URL and returns a GeoJSON FeatureCollection.
 *
 * @param url - Remote URL of the .fgb file.
 * @param options - Load options (maxFeatures, signal, onHeader).
 * @returns The deserialized FeatureCollection with metadata.
 */
export async function load(url: string, options?: FgbLoadOptions): Promise<FgbLoadResult> {
    return loadFgb(url, options);
}

// ─── loadBbox ────────────────────────────────────────────────────────────────

/**
 * Loads features from a FlatGeobuf file filtered by a bounding box.
 * Uses the FGB spatial index and HTTP Range requests for efficiency.
 *
 * @param url - Remote URL of the .fgb file.
 * @param bbox - Bounding box filter { minX, minY, maxX, maxY }.
 * @param options - Load options (maxFeatures, signal, onHeader).
 * @returns The filtered FeatureCollection.
 */
export async function loadBbox(
    url: string,
    bbox: FgbBbox,
    options?: FgbBboxOptions
): Promise<FgbLoadResult> {
    return loadFgbBbox(url, bbox, options);
}

// ─── loadAsLayer ──────────────────────────────────────────────────────────────

/**
 * Loads a complete FlatGeobuf file and adds it as a GeoJSON layer on the map.
 *
 * @param url - Remote URL of the .fgb file.
 * @param options - Layer options (layerId, visible, cluster, maxFeatures…).
 * @returns The created layer ID.
 */
export async function loadAsLayer(url: string, options: FgbLayerOptions = {}): Promise<string> {
    const result = await loadFgb(url, options);
    return _addDataToMap(result, options);
}

// ─── loadBboxAsLayer ──────────────────────────────────────────────────────────

/**
 * Loads FlatGeobuf features filtered by bbox and adds them as a GeoJSON layer.
 * Optionally sets up auto-refresh to re-fetch on viewport change.
 *
 * @param url - Remote URL of the .fgb file.
 * @param bbox - Initial bounding box filter.
 * @param options - Layer + bbox options (autoRefresh, debounceMs…).
 * @returns The created layer ID.
 */
export async function loadBboxAsLayer(
    url: string,
    bbox: FgbBbox,
    options: FgbLayerOptions = {}
): Promise<string> {
    const result = await loadFgbBbox(url, bbox, options);
    const layerId = _addDataToMap(result, options);

    // Set up auto-refresh if requested
    if (options.autoRefresh) {
        const adapter = _getGeoLeaf().Core?.getMap?.();
        const nativeMap =
            adapter && typeof adapter.getNativeMap === "function" ? adapter.getNativeMap() : null;

        if (nativeMap && typeof (nativeMap as { on?: unknown }).on === "function") {
            setupAutoRefresh(
                nativeMap as Parameters<typeof setupAutoRefresh>[0],
                url,
                options,
                (newBbox) => {
                    // The callback must return void. The body swallows every failure
                    // on purpose, so there is nothing to await and nothing to reject.
                    void (async () => {
                        try {
                            const refreshed = await loadFgbBbox(url, newBbox, options);
                            // In-place data replacement via the adapter (setData on the source).
                            adapter?.updateLayerData?.(layerId, refreshed.data);
                        } catch {
                            // Silently ignore auto-refresh errors (network, abort, etc.)
                        }
                    })();
                }
            );
        }
    }

    return layerId;
}
