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
import type { MeasureType, MeasureTypeDef, Units, PrintableAnnotation } from "./types.js";
import { getMeasureConfig } from "./config.js";
import { _warnNoCore, _getNativeMap } from "./internal.js";
import {
    initMenu,
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
import { initLayers } from "./draw-layers.js";
import { activateDistance, deactivateDistance } from "./tools/tool-distance.js";
import { activateRect, deactivateRect } from "./tools/tool-rect.js";
import { activateCircle, deactivateCircle } from "./tools/tool-circle.js";
import { activatePolygon, deactivatePolygon } from "./tools/tool-polygon.js";
import { activateGps, deactivateGps } from "./tools/tool-gps.js";
import {
    initAnnotationOverlays,
    createOverlayFromFeature,
    clearAllOverlays,
    getPrintableAnnotations as _getPrintableAnnotations,
} from "./annotation-overlays.js";
import { activateAnnotationTooltip, deactivateAnnotation } from "./tools/tool-annotation.js";
import { initPersistence, scheduleSave, clearStorage } from "./persistence.js";
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
}

/** Lazily initialises the floating menu, layers, engine, overlays, and restores localStorage. */
function _ensureMenu(): void {
    if (_menuInitialized) return;
    const map = _getNativeMap();
    if (!map) return;
    const cfg = getMeasureConfig();

    initEngine(cfg);
    setOnFeatureAdded(() => scheduleSave(getEngineCollection));
    initLayers(map);

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
            const kind = f.properties?.annotationKind as "label" | "tooltip" | undefined;
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
        if (map) positionMeasureMenuNear(_pillBtn, map.getContainer() as HTMLElement);
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
 */
export function startMeasure(type: MeasureType): void {
    if (_warnNoCore("startMeasure")) return;
    _ensureMenu();
    selectTool(type);
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
 * Registers a custom measure tool.
 * @param type - Unique identifier for the custom tool.
 * @param def - Tool definition (cursor, activate/deactivate callbacks).
 */
export function registerMeasureType(type: string, def: MeasureTypeDef): void {
    _customTools.set(type, def);
}
