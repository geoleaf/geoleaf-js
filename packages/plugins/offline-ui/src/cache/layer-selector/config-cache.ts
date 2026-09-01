/*!
 * @geoleaf-plugins/offline-ui
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Storage - Layer Selector / request memoisation
 *
 * PLUGINS S7 — collapses the two N+1 patterns of the cache modal.
 *
 * ⚠️ The two memos here have DELIBERATELY DIFFERENT LIFETIMES, and that
 * difference is the whole point of the module:
 *
 *  - `getLayerConfig()` — a layer's config JSON does not change while the page
 *    is open, so the memo lives as long as the module. Four call sites used to
 *    fetch the SAME url per layer (`core.populate`, `getLayerLabel`,
 *    `getLayerGeometryType`, `createStyleSelector`).
 *
 *  - `getCacheStatusOnce()` — the cached-resource manifest changes on EVERY
 *    download and every clear. Memoising it beyond a single pass over the rows
 *    would freeze the ✓/✗ icons at their pre-download value, which is the most
 *    visible behaviour of this UI. Hence the explicit `beginCacheStatusPass()`
 *    that `populate()` and `refreshCacheIcons()` each call before iterating.
 */

import { Log, fetchWithTimeout } from "@geoleaf/host-runtime";
import { coreConfigGet as configGet } from "@geoleaf/host-runtime";
import { StorageContract } from "../../shared/storage-contract.js";
import type { LayerLike } from "./layer-selector-types.js";

/** The subset of a layer's config JSON that the selector reads. */
interface LayerConfigJson {
    label?: string;
    geometryType?: string;
    dataFile?: string;
    styles?: {
        available?: Array<{ id?: string; label?: string }>;
        default?: string;
    };
}

/** Cached-resource manifest as returned by `CacheManager.getCacheStatus()`. */
interface CacheStatusLike {
    resources?: Array<{ url: string }>;
}

// —— Layer config (long-lived memo) ——————————————————————————————————————

/**
 * Keyed by resolved url, holding the PROMISE rather than the value.
 *
 * ⚠️ Storing resolved values would not dedupe anything here: `createLayerRow`
 * starts `getLayerLabel()` and `getLayerGeometryType()` without awaiting them
 * and then awaits `createStyleSelector()`, so the three requests are in flight
 * at the same time and no value would be cached yet when they start.
 */
const _configCache = new Map<string, Promise<LayerConfigJson | null>>();

/**
 * Resolves the on-disk path of a layer's config file, or `null` when the layer
 * carries no `configFile` (basemaps) or no profile is active.
 *
 * ⚠️ An `inlineConfig` layer never reaches this function — `getLayerConfig`
 * serves it first, from memory. This `null` therefore no longer means "inline
 * layer", it means "nothing to resolve".
 */
function resolveLayerConfigPath(layer: LayerLike): string | null {
    if (!layer.configFile) return null;
    const profileId = configGet("data.activeProfile", "") as string;
    if (!profileId) return null;
    const profilesBasePath = configGet("data.profilesBasePath", "profiles") as string;
    return `${profilesBasePath}/${profileId}/${layer.configFile}`;
}

async function _fetchLayerConfig(configPath: string): Promise<LayerConfigJson | null> {
    try {
        Log?.debug(`[LayerSelector] Loading layer config: ${configPath}`);
        const response = await fetchWithTimeout(fetch, configPath, {}, 10000);
        if (!response.ok) {
            Log?.error(`[LayerSelector] Failed to load config (${response.status}): ${configPath}`);
            return null;
        }
        return (await response.json()) as LayerConfigJson;
    } catch (error) {
        Log?.error(
            `[LayerSelector] Error loading config ${configPath}: ${(error as Error).message}`
        );
        return null;
    }
}

/**
 * A layer's config JSON — served from memory when it is inline, fetched at most
 * once per url otherwise.
 *
 * Never rejects — resolves `null` on any failure, matching what the four
 * former call sites each did on their own.
 */
export function getLayerConfig(layer: LayerLike): Promise<LayerConfigJson | null> {
    // 🛑 A TEMPLATED LAYER CARRIES ITS CONFIG INLINE, AND THERE IS NOTHING TO GO
    // FETCH. `expandLayerTemplates` sets `inlineConfig` and never `configFile`:
    // this function therefore returned `null` for them, and since the selector's
    // FOUR readers pass through here (`getLayerLabel`, `getLayerGeometryType`,
    // `createStyleSelector`, `core.populate`), `tourism`'s 24 templated layers
    // rendered with no label, no geometry and no style selector — measured in a
    // browser on 07/08/2026.
    //
    // ⚠️ The repair point is HERE and nowhere else: fixing the four readers would
    // have made four implementations of the same fallback. It is also why there
    // is no `_configCache` on this path — the value is already in memory,
    // memoising it would deduplicate nothing and would age data the core can
    // re-emit.
    if (layer.inlineConfig && typeof layer.inlineConfig === "object") {
        return Promise.resolve(layer.inlineConfig as LayerConfigJson);
    }

    const configPath = resolveLayerConfigPath(layer);
    if (!configPath) return Promise.resolve(null);

    const cached = _configCache.get(configPath);
    if (cached) return cached;

    const pending = _fetchLayerConfig(configPath);
    _configCache.set(configPath, pending);

    // A FAILED fetch must not stick for the life of the modal. Concurrent
    // callers still share the single in-flight attempt, but once it has failed
    // the entry is dropped so a later pass can retry — which is what the
    // per-site fetches used to do.
    void pending.then((value) => {
        if (value === null) _configCache.delete(configPath);
    });

    return pending;
}

// —— Cache status (per-pass memo) ————————————————————————————————————————

let _statusPass: Promise<CacheStatusLike | null> | null = null;
let _statusPassProfile = "";

async function _readCacheStatus(profileId: string): Promise<CacheStatusLike | null> {
    if (!StorageContract.isPluginLoaded() || !StorageContract.CacheManager) return null;
    try {
        return (await StorageContract.CacheManager.getCacheStatus(
            profileId
        )) as CacheStatusLike | null;
    } catch (error) {
        Log?.error(`[LayerSelector] Failed to read cache status: ${(error as Error).message}`);
        return null;
    }
}

/**
 * Opens a new pass: the next `getCacheStatusOnce()` re-reads the manifest.
 *
 * Call this at the TOP of any loop that checks several rows — `populate()` and
 * `refreshCacheIcons()` both do. Forgetting it does not corrupt anything, it
 * just serves the previous pass's manifest, which after a download means the
 * icons never turn green.
 */
export function beginCacheStatusPass(): void {
    _statusPass = null;
    _statusPassProfile = "";
}

/**
 * The cached-resource manifest, read once per pass instead of once per row.
 *
 * Never rejects — resolves `null` when the offline engine is absent or the read
 * fails, which callers read as "nothing is cached".
 */
export function getCacheStatusOnce(profileId: string): Promise<CacheStatusLike | null> {
    if (_statusPass && _statusPassProfile === profileId) return _statusPass;
    _statusPassProfile = profileId;
    _statusPass = _readCacheStatus(profileId);
    return _statusPass;
}
