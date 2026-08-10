/*!
 * @geoleaf-plugins/editor — Host-layer selection via map click
 * © 2026 Mattieu Pottier — MIT License
 *
 * When the "select" tool is active, this module intercepts map click events to
 * detect clicks on editable host GeoJSON layers (those granting `edition.create` or `edition.update`
 * in the GeoLeaf profile), loads the clicked feature into Terra Draw, and
 * selects it so the user can drag vertices and midpoints.
 *
 * Terra Draw's internal layers use the "td-" prefix and are excluded from the
 * click detection — Terra Draw handles clicks on its own features natively.
 * https://geoleaf.dev
 */
import type { TerraDrawAdapterInstance } from "../drawing/terra-draw-adapter.js";
import type { EditorMap, EditorMapMouseEvent } from "../types.js";
import { setSelection } from "./selection-state.js";
import { MODE_POINT, MODE_POLYLINE, MODE_POLYGON } from "../drawing/mode-names.js";
import { getEditableLayers } from "../config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Optional callbacks fired by the picker (wired in entry.ts). */
interface LayerPickerHooks {
    /** Fired after an existing host feature is loaded for editing (hide the original). */
    onHostFeatureSelected?: (layerId: string, featureId: string) => void;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

const _TERRA_DRAW_PREFIX = "td-";

let _clickHandler: ((e: EditorMapMouseEvent) => void) | null = null;
let _moveHandler: ((e: EditorMapMouseEvent) => void) | null = null;

let _map: EditorMap | null = null;
let _adapter: TerraDrawAdapterInstance | null = null;
let _hooks: LayerPickerHooks | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Attaches click and mousemove listeners on the native MapLibre map so that
 * clicking a host-layer feature (profile `edition.create`/`edition.update`) loads it into
 * Terra Draw for vertex editing.
 *
 * @param adapter - The active Terra Draw adapter.
 * @param map     - The native MapLibre GL map instance.
 * @param hooks   - Optional callbacks fired around a pick (guard checks, host notification).
 *                  Omitted, the picker selects without consulting the host.
 */

export function initLayerPicker(
    adapter: TerraDrawAdapterInstance,
    map: EditorMap,
    hooks?: LayerPickerHooks
): void {
    _map = map;
    _adapter = adapter;
    _hooks = hooks ?? null;

    _clickHandler = (e: EditorMapMouseEvent) => _handleClick(adapter, e);
    _moveHandler = (e: EditorMapMouseEvent) => _handleMove(e);

    map.on("click", _clickHandler);
    map.on("mousemove", _moveHandler);
}

/** Removes all listeners registered by {@link initLayerPicker}. */
export function destroyLayerPicker(): void {
    if (_map && _clickHandler) _map.off("click", _clickHandler);
    if (_map && _moveHandler) _map.off("mousemove", _moveHandler);
    _clickHandler = null;
    _moveHandler = null;
    _adapter = null;
    _map = null;
    _hooks = null;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function _handleClick(adapter: TerraDrawAdapterInstance, e: EditorMapMouseEvent): void {
    if (adapter.getActiveTool() !== "select") return;

    const map = _map;
    if (!map) return;
    const features = map.queryRenderedFeatures(e.point);

    // Pick the first feature from an editable host layer (not a terra-draw layer).
    // MapLibre renders profile layer "x" as sub-layers "gl-x-fill/line/circle/…",
    // so resolve the rendered layer id back to its profile id.
    const editable = _getEditableLayerIds();
    let layerId: string | null = null;
    const hit = features.find((f) => {
        if (f.layer.id.startsWith(_TERRA_DRAW_PREFIX)) return false;
        const resolved = _resolveEditableId(f.layer.id, editable);
        if (resolved) {
            layerId = resolved;
            return true;
        }
        return false;
    });
    if (!hit || !layerId) return;

    const geomType = hit.geometry.type;
    const modeName = _modeForGeometry(geomType);
    if (!modeName) return; // unsupported geometry type (Multi*, GeometryCollection, …)

    const featureId = hit.id != null ? String(hit.id) : "";

    // Load the host feature into Terra Draw so its vertices become draggable.
    // Do NOT forward the host feature id — Terra Draw assigns its own UUID and
    // ignores a passed id, but addFeatures returns the passed id, causing
    // selectFeature to fail ("No feature with this id"). featureId is preserved
    // separately in the selection snapshot for future persistence use.
    // Round coordinates to match TerraDrawMapLibreGLAdapter's coordinatePrecision.
    // queryRenderedFeatures returns floating-point artefacts (15+ decimals) from
    // MapLibre's tile system — Terra Draw rejects features with excessive precision.
    const roundedGeom = {
        type: hit.geometry.type as "Point" | "LineString" | "Polygon",
        coordinates: _roundCoords(hit.geometry.coordinates) as unknown[],
    };

    const tdId = adapter.addFeature({
        type: "Feature",
        geometry: roundedGeom,
        properties: { ...hit.properties, mode: modeName },
    } as Parameters<TerraDrawAdapterInstance["addFeature"]>[0]);

    if (tdId == null) return; // Terra Draw rejected the feature (unsupported or duplicate)

    // Persist the selection snapshot before Terra Draw fires its own onSelect event.
    setSelection({
        terradrawId: tdId,
        featureId,
        layerId,
        originalGeom: hit.geometry as { type: string; coordinates: unknown[] } as never,
    });

    // Hide the host original so only the editable Terra Draw copy is shown
    // (fixes the S8 visual duplication). No-op when the feature has no id.
    _hooks?.onHostFeatureSelected?.(layerId, featureId);

    // Arms the select mode and highlights the feature.
    adapter.selectFeature(tdId);
}

function _handleMove(e: EditorMapMouseEvent): void {
    const map = _map;
    if (!map) return;
    // Terra Draw owns the cursor when a drawing tool is armed — only pointer-hint in static/select.
    const activeTool = _adapter?.getActiveTool() ?? null;
    if (activeTool !== null && activeTool !== "select") return;

    const features = map.queryRenderedFeatures(e.point);
    const editable = _getEditableLayerIds();
    const isHover = features.some(
        (f) =>
            !f.layer.id.startsWith(_TERRA_DRAW_PREFIX) &&
            _resolveEditableId(f.layer.id, editable) !== null
    );
    const canvas: HTMLCanvasElement | null | undefined = map.getCanvas?.();
    if (canvas) canvas.style.cursor = isHover ? "pointer" : "";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Must match the coordinatePrecision set on TerraDrawMapLibreGLAdapter (9).
// MapLibre returns coordinates with 15+ decimal places from queryRenderedFeatures
// (floating-point artefacts from the tile system) — Terra Draw rejects these.
const _COORD_PRECISION = 9;
const _COORD_FACTOR = 10 ** _COORD_PRECISION;

function _round(n: number): number {
    return Math.round(n * _COORD_FACTOR) / _COORD_FACTOR;
}

/** Recursively rounds all numeric values in a coordinate tree. */
function _roundCoords(c: unknown): unknown {
    if (typeof c === "number") return _round(c);
    if (Array.isArray(c)) return c.map(_roundCoords);
    return c;
}

function _getEditableLayerIds(): Set<string> {
    // No geometry filter: the picker must be able to select any editable layer's
    // feature. Passing a geometryType here would silently make layers unclickable.
    return new Set(getEditableLayers().map((l) => l.id));
}

/**
 * Resolves a rendered MapLibre layer id back to its editable profile layer id.
 * Core renders profile layer `x` as sub-layers `gl-x-{fill|line|casing|circle|symbol|…}`
 * (see core `toSubLayerId` / `LAYER_PREFIX`). Also accepts a raw id match for
 * layers added without the prefix. Returns null if no editable layer matches.
 */
function _resolveEditableId(renderedLayerId: string, editable: Set<string>): string | null {
    if (editable.has(renderedLayerId)) return renderedLayerId; // raw (unprefixed) match
    for (const id of editable) {
        if (renderedLayerId.startsWith(`gl-${id}-`)) return id;
    }
    return null;
}

function _modeForGeometry(geomType: string): string | null {
    switch (geomType) {
        case "Point":
            return MODE_POINT;
        case "LineString":
            return MODE_POLYLINE;
        case "Polygon":
            return MODE_POLYGON;
        default:
            return null;
    }
}
