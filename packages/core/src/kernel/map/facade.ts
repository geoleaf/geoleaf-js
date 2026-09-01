/*!
 * GeoLeaf Core – Core / Facade
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

import { Log } from "../../utils/log/index.js";
import { CONSTANTS } from "../../utils/constants/constants.js";
import { resolveMapContainer, applyThemeSafe } from "./map-container.js";
import { setTheme, getTheme } from "./theme.js";
import { runLifecycleTeardowns } from "../shared/lifecycle.js";
import { MaplibreAdapter } from "../../adapters/maplibre/maplibre-adapter.js";
import type {
    IMapAdapter,
    MapInitOptions,
    GeoLeafBounds,
} from "../../contracts/map-adapter.contract.js";

// Narrow view of the global `GeoLeaf` namespace member read here.
interface CoreGlobal {
    GeoLeaf?: { Core?: { onError?(err: unknown): void } };
}

// Engine-level map options forwarded from the normalised init options.
interface MapEngineOptions {
    minZoom?: number;
    maxZoom?: number;
    maxPitch?: number;
    maxBounds?: unknown;
    preserveDrawingBuffer?: boolean;
}

// Normalised GeoLeaf options produced by APIInitializationManager._normalizeInitOptions().
interface NormalizedInitOptions {
    mapId?: string;
    center?: unknown;
    zoom?: number;
    theme?: string;
    mapOptions?: MapEngineOptions;
    // Pre-created adapter injected by the boot sequence (boot.ts → CoreMapModule.init(adapter)
    // → GeoLeaf.init() options → here), reused by _createInstance() instead of creating a
    // second one. Absent for direct GeoLeaf.init() calls (a fresh adapter is then created).
    _adapter?: IMapAdapter;
}

// ES2022 target + Node ≥ 18: globalThis is always defined.
const _g = globalThis as unknown as CoreGlobal;

// Keyed registry of active map adapters: mapId → IMapAdapter.
// Replaces the former module-level singleton to support N coexisting maps on one page.
const _instances = new Map<string, IMapAdapter>();

// ── Private helpers ───────────────────────────────────────────────────────────

/**
 * Builds a GeoLeafLatLng center from a [lat, lng] array coming from the config.
 * Returns undefined when the value is absent or malformed.
 */
function _centerFromArray(raw: unknown): { lat: number; lng: number } | undefined {
    if (!Array.isArray(raw) || raw.length < 2) return undefined;
    return { lat: Number(raw[0]), lng: Number(raw[1]) };
}

/**
 * Extracts maxBounds from mapOptions if it is a plain GeoLeafBounds object.
 * After the migration of app/init.ts, maxBounds is produced by padBounds()
 * and is always a GeoLeafBounds — not a Leaflet LatLngBounds.
 */
function _maxBoundsFromOpts(mapOptions: MapEngineOptions | undefined): GeoLeafBounds | undefined {
    const b = mapOptions?.maxBounds;
    if (!b || typeof b !== "object") return undefined;
    const bag = b as Record<string, unknown>;
    if (
        typeof bag.north === "number" &&
        typeof bag.south === "number" &&
        typeof bag.east === "number" &&
        typeof bag.west === "number"
    ) {
        return b as GeoLeafBounds;
    }
    return undefined;
}

/**
 * Builds a MapInitOptions object from the normalised GeoLeaf options
 * produced by APIInitializationManager._normalizeInitOptions().
 */
function _buildInitOptions(container: HTMLElement, options: NormalizedInitOptions): MapInitOptions {
    const center = _centerFromArray(options.center);
    const maxBounds = _maxBoundsFromOpts(options.mapOptions);
    return {
        container,
        ...(center !== undefined && { center }),
        // `Number.isFinite` does not narrow its argument's type: without the
        // existence test, the true branch stays `number | undefined`. Identical
        // behaviour — `isFinite(undefined)` is false — but the typing now sees
        // it.
        zoom:
            options.zoom !== undefined && Number.isFinite(options.zoom)
                ? options.zoom
                : CONSTANTS.DEFAULT_ZOOM,
        ...(options.mapOptions?.minZoom !== undefined && { minZoom: options.mapOptions.minZoom }),
        ...(options.mapOptions?.maxZoom !== undefined && { maxZoom: options.mapOptions.maxZoom }),
        ...(options.mapOptions?.maxPitch !== undefined && {
            maxPitch: options.mapOptions.maxPitch,
        }),
        ...(maxBounds !== undefined && { maxBounds }),
        ...(options.mapOptions?.preserveDrawingBuffer === true && {
            preserveDrawingBuffer: true as const,
        }),
    };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Initialises the map with the given options.
 * Resolves the container element, creates a MaplibreAdapter,
 * and applies the UI theme.
 *
 * @param options - Normalised map options.
 * @param options.mapId - DOM element id for the map container.
 * @param options.center - Initial center as `[lat, lng]`.
 * @param options.zoom - Initial zoom level.
 * @param options.theme - UI theme identifier (e.g. `"light"`, `"dark"`).
 * @param options.mapOptions - Additional engine options (minZoom, maxZoom, maxBounds).
 * @returns The active `IMapAdapter` instance, or `null` on error.
 */
/** Forwards an init error to the optional Core.onError() callback, guarding against throws. */
function _notifyError(err: unknown): void {
    if (typeof _g.GeoLeaf?.Core?.onError !== "function") return;
    try {
        _g.GeoLeaf.Core.onError(err);
    } catch (cbErr) {
        Log.error("[GeoLeaf.Core] Error in Core.onError():", cbErr);
    }
}

/** Creates and registers a new adapter for `id`. Theme binds to the first map only. */
function _createInstance(id: string, options: NormalizedInitOptions): IMapAdapter {
    const container = resolveMapContainer(id);
    // Reuse the adapter injected by the boot sequence via options._adapter, if any;
    // otherwise create a fresh one (direct GeoLeaf.init() calls).
    const adapter = options._adapter ?? new MaplibreAdapter();
    adapter.init(_buildInitOptions(container, options));

    const isFirst = _instances.size === 0;
    _instances.set(id, adapter);

    // Theme binds to the first map only. The legend now mounts on
    // geoleaf:app:ready via LegendLifecycle (no boot-time init here).
    if (isFirst) {
        applyThemeSafe(options.theme || "light");
    }
    return adapter;
}

function init(options: NormalizedInitOptions = {}): IMapAdapter | null {
    const context = "[GeoLeaf.Core]";
    const id = options.mapId;

    if (!id) {
        Log.error(`${context} init() requires options.mapId`);
        return null;
    }

    if (_instances.has(id)) {
        Log.warn(`${context} Map "${id}" already initialized. Returning existing instance.`);
        return _instances.get(id)!;
    }

    try {
        const adapter = _createInstance(id, options);
        Log.info(`${context} Map "${id}" initialized successfully.`);
        return adapter;
    } catch (err) {
        Log.error(
            `${context} init failed for "${id}":`,
            (err as Error | undefined)?.message ?? err
        );
        _notifyError(err);
        _instances.delete(id);
        return null;
    }
}

// ── Accessors ─────────────────────────────────────────────────────────────────

/**
 * Returns a map adapter instance.
 *
 * @param mapId - Optional map id. When provided, returns the adapter registered
 *   under that id (or `null`). When omitted, returns the first active instance —
 *   sufficient for single-map applications (backward compatible).
 * @returns The matching `IMapAdapter`, or `null` if none.
 */
function getMap(mapId?: string): IMapAdapter | null {
    if (mapId) return _instances.get(mapId) ?? null;
    return _instances.values().next().value ?? null;
}

/**
 * Destroys a map instance and frees its registry slot.
 * Consumers MUST call this when unmounting their component (e.g. React unmount).
 *
 * When the **last** map is destroyed, the shared business state (POI, GeoJSON,
 * LayerManager, Profile) is torn down via the lifecycle seam so a subsequent
 * `Core.init()` starts clean — this is what supports the create → destroy →
 * recreate cycle without leaked markers/layers/profile or a dead adapter
 * reference. Destroying one of several coexisting maps frees only that slot.
 *
 * @param mapId - The id of the map to destroy.
 * @returns `true` if an instance was found and destroyed, `false` otherwise.
 */
function destroy(mapId: string): boolean {
    const context = "[GeoLeaf.Core]";
    const adapter = _instances.get(mapId);
    if (!adapter) {
        Log.warn(`${context} destroy: no instance for "${mapId}"`);
        return false;
    }
    try {
        adapter.destroy();
    } catch (e) {
        Log.warn(`${context} adapter destroy threw:`, e);
    }
    _instances.delete(mapId);

    // Once the last map is gone, tear down the shared business state (POI,
    // GeoJSON, LayerManager, Profile) so a subsequent Core.init() starts clean —
    // no leaked markers/layers/profile, no dead adapter reference. The stores
    // self-register their reset() via the lifecycle seam (IoC, no coupling).
    if (_instances.size === 0) {
        runLifecycleTeardowns();
    }
    return true;
}

/**
 * Tells whether a map instance is registered under the given id.
 *
 * @param mapId - The id to check.
 * @returns `true` if an instance exists for `mapId`.
 */
function hasMap(mapId: string): boolean {
    return _instances.has(mapId);
}

/**
 * Lists the ids of all currently active map instances.
 *
 * @returns An array of active map ids (useful for devtools and tests).
 */
function listMaps(): string[] {
    return Array.from(_instances.keys());
}

// ── Attachment ────────────────────────────────────────────────────────────────

/**
 * Tells whether a map is registered **and** its container is still in the document.
 *
 * Distinct from {@link hasMap}, which answers the weaker question: `hasMap()` says the
 * registry holds an entry, `isAttached()` says that entry is still wired into the page.
 * They diverge exactly where it matters — a host that removed the map's subtree without
 * calling {@link destroy} leaves a registered map that renders nowhere.
 *
 * @param mapId - The id to check.
 * @returns `true` when an instance exists for `mapId` and its container is attached.
 *
 * @example
 * ```ts
 * const Core = GeoLeaf?.Core;
 * if (Core && !Core.isAttached("main")) {
 *     Core.reattach("main", document.getElementById("slot")!);
 * }
 * ```
 */
function isAttached(mapId: string): boolean {
    const adapter = _instances.get(mapId);
    if (!adapter) return false;
    try {
        return document.contains(adapter.getContainer());
    } catch {
        // `getContainer()` goes through the adapter's readiness guard and THROWS once
        // the map has been destroyed. A destroyed map is not attached — that is an
        // answer, not an error, so it must not propagate to the caller.
        return false;
    }
}

/**
 * Moves a live map into another parent element, without destroying and rebuilding it.
 *
 * The whole container is re-parented; its children are NOT moved one by one. That is
 * forced by the engine, not a preference: MapLibre memorises the element it was
 * constructed with, so moving the children would leave `map.getContainer()` pointing at
 * the old node and every subsequent measurement wrong. Integrators who lacked a handle
 * on the map did move the children, and inherited exactly that bug.
 *
 * ⚠️ **The panels do not follow.** `#gl-right-panel` and its siblings live in the shell
 * (`glMain`), not inside the map container, so they stay where they are. Rebuilding them
 * around the new location is the host's call, through three already-public exports:
 * `GeoLeaf.UI.destroyDesktopPanel()` → `initDesktopPanel()` → `activateDesktopPanel()`.
 * Making them follow would tie this API to the shell's DOM — the very coupling it exists
 * to remove.
 *
 * @param mapId - The id of the map to move.
 * @param parent - The element that should receive the map container.
 * @returns `true` when the map was found and moved, `false` otherwise.
 *
 * @example
 * ```ts
 * const ok = GeoLeaf?.Core?.reattach("main", document.getElementById("fullscreen-slot")!);
 * ```
 */
function reattach(mapId: string, parent: HTMLElement): boolean {
    const context = "[GeoLeaf.Core]";
    const adapter = _instances.get(mapId);
    if (!adapter) {
        Log.warn(`${context} reattach: no instance for "${mapId}"`);
        return false;
    }
    if (!parent || typeof parent.appendChild !== "function") {
        Log.warn(`${context} reattach: "${mapId}" needs a parent element to move into`);
        return false;
    }

    let container: HTMLElement;
    try {
        container = adapter.getContainer();
    } catch (e) {
        // Same guard as isAttached(): a destroyed map throws here.
        Log.warn(`${context} reattach: "${mapId}" has no live container:`, e);
        return false;
    }

    if (container.parentElement === parent) return true;
    parent.appendChild(container);

    // The canvas keeps the drawing-buffer size it was built with, so a parent of
    // different dimensions renders at the old size until the engine is told.
    // Optional at the contract, hence `?.` — its absence means "no telling needed".
    adapter.resize?.();
    return true;
}

// ── Public Core object ────────────────────────────────────────────────────────

/**
 * The `GeoLeaf.Core` façade — map lifecycle and the handles onto the live instance.
 *
 * The entry point an integrator boots through, and the only supported way to reach the
 * underlying MapLibre instance: the adapter it hands back is what keeps profile-driven
 * behaviour and direct map calls from diverging.
 */
export const Core = {
    init,
    getMap,
    /** Alias for getMap — returns an IMapAdapter (used by POI, Route, GeoJSON modules). */
    getAdapter: getMap,
    destroy,
    hasMap,
    listMaps,
    isAttached,
    reattach,
    setTheme,
    getTheme,
};
