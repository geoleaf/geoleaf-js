/*!
 * @geoleaf-plugins/measure — API implementation
 * © 2026 Mattieu Pottier — MIT License
 *
 * The measure plugin's lifecycle: module state, lazy menu/engine/overlay bootstrap,
 * tool arming and the exported operations behind `GeoLeaf.Measure.*`.
 *
 * Split out of `public-api.ts` (backlog B.12), which carried all of it — 12 functions and
 * 20 branches, including the whole `_ensureMenu()` bootstrap. `public-api.ts` now only
 * shapes the API object (INV-FACADE).
 *
 * ✅ CDC finding #1 (MAJEUR) is FIXED: `startMeasure()` now arms through `selectTool()`,
 * the same path a button click takes, so the drawing handlers are actually wired.
 * https://geoleaf.dev
 */
import type { MeasureToolId, MeasureTypeDef, Units, PrintableAnnotation } from "./types.js";
import { getMeasureConfig } from "./config.js";
import { _warnNoCore, _getNativeMap } from "./internal.js";
import {
    initMenu,
    destroyMenu,
    toggleMeasureMenu,
    setActiveTool,
    selectTool,
    setCurrentUnits,
    getCurrentUnits,
    positionMeasureMenuNear,
} from "./floating-menu.js";
import {
    initEngine,
    setOnFeatureAdded,
    addSurfaceFeature,
    clearEngineCollection,
    getEngineCollection,
    loadCollection,
    removeFeatureById,
    rerenderLabels,
} from "./measure-engine.js";
import { initLayers, releaseLayers } from "./draw-layers.js";
import { activateDistance, deactivateDistance } from "./tools/tool-distance.js";
import { activateRect, deactivateRect } from "./tools/tool-rect.js";
import { activateCircle, deactivateCircle } from "./tools/tool-circle.js";
import { activatePolygon, deactivatePolygon } from "./tools/tool-polygon.js";
import { activateGps, deactivateGps } from "./tools/tool-gps.js";
import {
    initAnnotationOverlays,
    destroyAnnotationOverlays,
    createOverlayFromFeature,
    clearAllOverlays,
    getPrintableAnnotations as _getPrintableAnnotations,
} from "./annotation-overlays.js";
import { activateAnnotationTooltip, deactivateAnnotation } from "./tools/tool-annotation.js";
import { activateCustom, deactivateCustom } from "./tools/tool-custom.js";
import { initPersistence, scheduleSave, clearStorage, flushPendingSave } from "./persistence.js";
import { exportGeoJSON as _exportGeoJSON } from "./geojson-export.js";

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _menuInitialized = false;
let _pillBtn: Element | null = null;
let _menuPositioned = false;
const _customTools = new Map<string, MeasureTypeDef>();

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Deactivates all tools that may currently be running. */
function _deactivateAll(): void {
    deactivateDistance();
    deactivateRect();
    deactivateCircle();
    deactivatePolygon();
    deactivateGps();
    deactivateAnnotation();
    // A registered tool is disarmed by the same sweep as the built-ins — otherwise
    // `stopMeasure()`, `clearAll()` and closing the menu would each leave a third-party tool
    // armed, holding exclusive mode and the cursor.
    deactivateCustom();
}

/** What a call that came before the map can do about it. */
const NOT_READY_HINT =
    "nothing was opened. Call again once the application is ready (`geoleaf:app:ready`).";

/**
 * Lazily initialises the floating menu, layers, engine, overlays, and restores localStorage.
 *
 * A call that comes too early — before the map exists, or while its style is still loading —
 * initialises nothing and SAYS so: it used to return without a word in the first case, and to
 * let `addSource` throw in the second, where the caller is a toolbar listener and the
 * exception an uncaught error on the page. Nothing is latched: the next call tries again.
 */
function _ensureMenu(): void {
    if (_menuInitialized) return;
    const map = _getNativeMap();
    if (!map) {
        console.warn(`[GeoLeaf.Measure] The map is not there yet — ${NOT_READY_HINT}`);
        return;
    }
    const cfg = getMeasureConfig();

    initEngine(cfg);
    setOnFeatureAdded(() => scheduleSave(getEngineCollection));
    try {
        initLayers(map);
    } catch (e) {
        console.warn(`[GeoLeaf.Measure] The map style is still loading — ${NOT_READY_HINT}`, e);
        return;
    }

    // Init annotation overlay system
    initAnnotationOverlays(map, cfg, {
        onCreated: (f) => {
            if (getEngineCollection().features.length >= cfg.maxFeatures) {
                console.warn(
                    `[GeoLeaf.Measure] maxFeatures (${cfg.maxFeatures}) reached — annotation not added`
                );
                return;
            }
            addSurfaceFeature(f);
            scheduleSave(getEngineCollection);
        },
        onMutated: () => scheduleSave(getEngineCollection),
        onRemoved: (id) => {
            removeFeatureById(id);
            scheduleSave(getEngineCollection);
        },
    });

    // Boot restoration from localStorage
    const savedFeatures = initPersistence(cfg);
    if (savedFeatures?.length) {
        loadCollection(savedFeatures);
        for (const f of savedFeatures) {
            const kind = f.properties?.annotationKind;
            if (kind === "label" || kind === "tooltip") createOverlayFromFeature(f);
        }
    }

    initMenu(cfg, {
        onToggle: (open) => {
            _pillBtn?.classList.toggle("gl-map-toolbar__btn--active", open);
        },
        onToolSelect: (type) => {
            _deactivateAll();
            if (type === "distance") activateDistance(map);
            else if (type === "rect") activateRect(map);
            else if (type === "circle") activateCircle(map);
            else if (type === "polygon") activatePolygon(map);
            else if (type === "gps") activateGps(map, () => setActiveTool(null));
            else if (type === "annotation-tooltip") activateAnnotationTooltip(map);
            else if (type !== null) {
                // Registered tools. The lookup is what makes `registerMeasureType()`
                // more than a write to a map nobody read.
                // ⚠️ An id that is NOT registered must keep falling through to "deactivate
                // only" — that behaviour is asserted, and it is what makes a typo silent-safe
                // rather than half-arming something.
                const def = _customTools.get(type);
                if (def) activateCustom(map, type, def);
            }
        },
        onUnitsChange: (u) => {
            setCurrentUnits(u);
            rerenderLabels(getCurrentUnits());
        },
        onClearAll: () => clearAll(),
        onExport: () => {
            exportGeoJSON().catch((err) => console.error("[GeoLeaf.Measure] export error:", err));
        },
    });
    _menuInitialized = true;
}

// ---------------------------------------------------------------------------
// Public functions
// ---------------------------------------------------------------------------

/**
 * Opens or closes the floating measure sub-menu.
 * Also calls `_ensureMenu()` so tools work on first click.
 * @param btn - The pill toolbar button element (used for active-state toggle).
 */
export function openMeasureMenu(btn?: Element): void {
    if (_warnNoCore("openMeasureMenu")) return;
    if (btn) _pillBtn = btn;
    _ensureMenu();
    toggleMeasureMenu();
    // On first open: center the submenu on the pill bar, placed to its right
    if (_pillBtn && !_menuPositioned) {
        const map = _getNativeMap();
        if (map) positionMeasureMenuNear(_pillBtn, map.getContainer());
        _menuPositioned = true;
    }
}

/**
 * Arms the specified measure tool (changes cursor, activates drawing mode).
 *
 * Goes through `selectTool`, i.e. the same path a click on the tool's button takes.
 * It used to call `setActiveTool`, which only lights the button up: the tool appeared
 * armed and no drawing handler was ever wired, so nothing happened when the user
 * clicked the map. That was CDC finding #1 (MAJEUR) — fixed.
 *
 * Accepts one of the six built-in identifiers, or any id passed to
 * {@link registerMeasureType} beforehand. An id that matches neither disarms whatever was
 * armed and does nothing else — deliberately, so a typo cannot half-arm a tool.
 *
 * @param type - Tool identifier.
 */
export function startMeasure(type: MeasureToolId): void {
    if (_warnNoCore("startMeasure")) return;
    _ensureMenu();
    selectTool(type);
}

/**
 * Takes the measure tools down with the application: the tool armed, the menu, the overlays,
 * the collection held in memory, and the map they were all built on.
 *
 * 🛑 **Everything `_ensureMenu()` builds closes over ONE map**, and it was built once for ever:
 * the latch below was never released. `GeoLeaf.mount()` unmounts the application and boots it
 * again on a new map — the menu then stayed in the page of the unmounted application, and on
 * the next one a tool armed drew nothing: its layers had never been created on the new map,
 * its handlers were on the old one. Released here, the next activation builds it all again.
 *
 * The measures are NOT lost when the profile persists them: the pending save is flushed
 * BEFORE the collection is emptied, and the next `_ensureMenu()` restores it from storage.
 * Storage itself is left alone — `clearAll()` is the user's gesture, not a teardown's.
 *
 * Called while the map is still alive. Idempotent, and a no-op when nothing was built.
 */
export function destroyMeasure(): void {
    if (!_menuInitialized) return;
    try {
        // The tools first: their handlers, the cursor and the exclusive mode are on the map.
        _deactivateAll();
        flushPendingSave();
        destroyAnnotationOverlays();
        clearEngineCollection();
    } finally {
        // Released whatever a step above met — a host may have destroyed the map first. A latch
        // left set is what makes the next application's button arm nothing.
        destroyMenu();
        releaseLayers();
        _menuInitialized = false;
        _pillBtn = null;
        _menuPositioned = false;
    }
}

/** Terminates or cancels the currently active measure tool. */
export function stopMeasure(): void {
    if (_warnNoCore("stopMeasure")) return;
    _deactivateAll();
    setActiveTool(null);
}

/**
 * Clears all features, drawing layers, annotation overlays, the recap box and the
 * localStorage entry. The recap box is emptied by `clearEngineCollection()`.
 */
export function clearAll(): void {
    if (_warnNoCore("clearAll")) return;
    _deactivateAll();
    setActiveTool(null);
    clearAllOverlays();
    clearEngineCollection();
    clearStorage(getMeasureConfig());
}

/** Returns a deep copy of the current FeatureCollection (measures + annotations). */
export function getCollection(): GeoJSON.FeatureCollection {
    return getEngineCollection();
}

/**
 * Exports the current FeatureCollection as a GeoJSON Blob and (by default) triggers download.
 * @param opts.download - Set false to return the Blob without downloading.
 * @param opts.fileName - Override the default export filename.
 */
export async function exportGeoJSON(opts?: {
    download?: boolean;
    fileName?: string;
}): Promise<Blob> {
    return _exportGeoJSON(getEngineCollection(), opts, getMeasureConfig());
}

/** Changes the active distance and/or area units and re-renders visible labels. */
export function setUnits(u: Partial<Units>): void {
    if (_warnNoCore("setUnits")) return;
    setCurrentUnits(u);
    rerenderLabels(getCurrentUnits());
}

/** Returns the currently active distance and area units. */
export function getUnits(): Units {
    return getCurrentUnits();
}

/**
 * Returns printable annotation descriptors for the print plugin canvas renderer.
 * Only annotations within the map viewport are included.
 */
export function getPrintableAnnotations(): PrintableAnnotation[] {
    return _getPrintableAnnotations();
}

/**
 * Registers a custom measure tool, armable afterwards through {@link startMeasure}.
 *
 * The plugin wraps the definition's callbacks in the same envelope the built-in tools carry —
 * exclusive mode, cursor, cursor guard — so a registered tool behaves as a peer of the six.
 * Map listeners, drawing state and feature production stay the caller's.
 *
 * ⚠️ **No button appears in the floating menu.** Its buttons come from a static table carrying
 * an icon and i18n keys, which {@link MeasureTypeDef} does not provide; `enabledTools` filters
 * that table and ignores registered ids. Trigger a custom tool from your own UI:
 *
 * ```js
 * GeoLeaf.Measure.registerMeasureType("denivele", {
 *     cursor: "cell",
 *     onActivate: (map) => { ... },
 *     onDeactivate: () => { ... },
 * });
 * myButton.addEventListener("click", () => GeoLeaf.Measure.startMeasure("denivele"));
 * ```
 *
 * ⚠️ **This did nothing at all until 14/08/2026** — it wrote to a registry no code read, while
 * the spec advertised extensibility.
 *
 * @param type - Unique identifier. Re-registering an id replaces its definition.
 * @param def - Tool definition (cursor, activate/deactivate callbacks). All fields optional.
 */
export function registerMeasureType(type: string, def: MeasureTypeDef): void {
    _customTools.set(type, def);
}
