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
import { resolveFeatureId } from "../feature-id.js";
import { getGeoLeaf, Log } from "@geoleaf/host-runtime";

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

    // 🛑 `hit.id` ALONE RESOLVED TO NOTHING ON EVERY LINE AND POLYGON LAYER. The core sets
    // `promoteId` on POINT sources only, so MapLibre hands back no top-level id there — and
    // `featureId` guards the deselect commit (`events.ts`), the dirty flag, the three
    // host-reconcile entry points and `submit`. "Select → edit → save" therefore persisted
    // NOTHING, without an error. `host-reconcile` already read both spellings; the picker
    // was the one place that did not.
    const featureId = resolveFeatureId(hit);

    // Prefer the SOURCE geometry over the one `queryRenderedFeatures` handed back: the
    // latter is what MapLibre rasterised, clipped to roughly 1.5 tile. Editing that copy and
    // saving it truncates the feature in the store, and the truncated shape is perfectly
    // valid — so nothing downstream can catch it.
    const sourceGeom = featureId ? _sourceGeometry(layerId, featureId) : null;
    const geom = sourceGeom ?? hit.geometry;

    _loadForEditing(adapter, layerId, featureId, geom, hit.properties);
}

/**
 * Loads one host feature into Terra Draw and selects it — the body shared by the click path
 * and by {@link selectHostFeature}.
 *
 * @param adapter    - The armed Terra Draw adapter.
 * @param layerId    - Profile layer the feature belongs to.
 * @param featureId  - Identity resolved by {@link resolveFeatureId}; may be `""`.
 * @param geom       - Geometry to make editable (source when readable, tile otherwise).
 * @param properties - Properties carried onto the Terra Draw copy.
 * @returns whether the feature was loaded and selected.
 */
function _loadForEditing(
    adapter: TerraDrawAdapterInstance,
    layerId: string,
    featureId: string,
    geom: { type: string; coordinates: unknown },
    properties: Record<string, unknown>
): boolean {
    const modeName = _modeForGeometry(geom.type);
    if (!modeName) return false; // unsupported geometry type (Multi*, GeometryCollection, …)

    // Do NOT forward the host feature id — Terra Draw assigns its own UUID and
    // ignores a passed id, but addFeatures returns the passed id, causing
    // selectFeature to fail ("No feature with this id"). featureId is preserved
    // separately in the selection snapshot for future persistence use.
    // Round coordinates to match TerraDrawMapLibreGLAdapter's coordinatePrecision.
    // ⚠️ Applied to BOTH paths: the tile geometry carries floating-point artefacts
    // (15+ decimals) from MapLibre's tile system, and a source GeoJSON is free to carry just
    // as many. Terra Draw rejects features with excessive precision either way.
    const roundedGeom = {
        type: geom.type as "Point" | "LineString" | "Polygon",
        coordinates: _roundCoords(geom.coordinates) as unknown[],
    };

    const tdId = adapter.addFeature({
        type: "Feature",
        geometry: roundedGeom,
        properties: { ...properties, mode: modeName },
    } as Parameters<TerraDrawAdapterInstance["addFeature"]>[0]);

    if (tdId == null) return false; // Terra Draw rejected the feature (unsupported or duplicate)

    // Persist the selection snapshot before Terra Draw fires its own onSelect event.
    setSelection({
        terradrawId: tdId,
        featureId,
        layerId,
        originalGeom: geom as { type: string; coordinates: unknown[] } as never,
    });

    // Hide the host original so only the editable Terra Draw copy is shown
    // (fixes the S8 visual duplication). No-op when the feature has no id.
    _hooks?.onHostFeatureSelected?.(layerId, featureId);

    // Arms the select mode and highlights the feature.
    adapter.selectFeature(tdId);
    return true;
}

/**
 * Loads an existing host feature for editing WITHOUT a map click.
 *
 * The duplicate guard's "modify the existing one" answer: the surveyor tapped next to a
 * feature that is already recorded, so what they want is that feature open, not a second
 * one created on top of it.
 *
 * 🛑 NO TILE FALLBACK HERE, unlike the click path. A click always has a rasterised geometry
 * in hand; this entry has only an identity, so when the source cannot be read there is
 * simply nothing to load — and inventing a geometry would be worse than refusing.
 *
 * @param layerId   - Profile layer the feature belongs to.
 * @param featureId - Host identity of the feature to open.
 * @returns `false` when the picker is not armed, the source is unreadable, or Terra Draw
 *   refuses the geometry — the caller must then say so rather than appear to have worked.
 * @example
 * if (!selectHostFeature("candelabres", "c-7")) notifyUnavailable();
 */
export function selectHostFeature(layerId: string, featureId: string): boolean {
    const adapter = _adapter;
    if (!adapter || !featureId) return false;
    const found = _sourceFeature(layerId, featureId);
    if (!found?.geometry) return false;
    return _loadForEditing(adapter, layerId, featureId, found.geometry, found.properties ?? {});
}

function _handleMove(e: EditorMapMouseEvent): void {
    const map = _map;
    if (!map) return;
    // Terra Draw owns the cursor when a drawing tool is armed — only pointer-hint in static/select.
    const activeTool = _adapter?.getActiveTool() ?? null;
    if (activeTool !== null && activeTool !== "select") return;
    // …and so does ANY other plugin's armed tool (measure, proximity search): they announce it
    // with `__geoleafExclusiveMode`. The check above only ever saw the editor's OWN tools, so a
    // crosshair armed elsewhere was overwritten on every mousemove — this handler fires on move,
    // not on enter/leave, so it wins any race a MutationObserver could put up.
    if (map.__geoleafExclusiveMode) return;

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

/**
 * The feature as the SOURCE holds it, or `null` when it cannot be read.
 *
 * `GeoLeaf.Layers.getFeatureById` matches on the top-level id AND on `properties.id`
 * (`kernel/geojson/layers-public-api.ts`), so it resolves the same identity this module
 * just did.
 *
 * 🛑 THE `null` PATH IS NOT AN ERROR PATH, and the caller must keep falling back to the
 * tile copy. A vector-tile layer keeps `features: []` in the core by construction
 * (`capabilities/vector-tiles/`), so its source is unreachable and always will be; a layer
 * declared in the profile but never loaded THROWS rather than returning `[]` — the same
 * constraint `drawing/poi-snap.ts` and `persistence/session-export.ts` already guard
 * against. In both cases the tile geometry is all there is, and refusing the selection
 * would be a worse answer than editing a clipped copy.
 *
 * @param layerId   - Profile layer the feature belongs to.
 * @param featureId - Identity resolved by {@link resolveFeatureId}, never empty.
 * @returns the source feature, or `null` when unreadable.
 */
/** A feature as the SOURCE holds it, narrowed to what this module reads off it. */
interface SourceFeature {
    geometry: { type: string; coordinates: unknown };
    properties?: Record<string, unknown>;
}

function _sourceFeature(layerId: string, featureId: string): SourceFeature | null {
    try {
        const found = getGeoLeaf()?.Layers?.getFeatureById?.(layerId, featureId) as
            | {
                  geometry?: { type?: string; coordinates?: unknown };
                  properties?: Record<string, unknown>;
              }
            | null
            | undefined;
        const geometry = found?.geometry;
        if (!geometry?.type || geometry.coordinates === undefined) return null;
        return {
            geometry: geometry as { type: string; coordinates: unknown },
            ...(found?.properties && { properties: found.properties }),
        };
    } catch (e) {
        Log?.debug?.("[editor/picker] Source unreadable, editing the tile copy:", layerId, e);
        return null;
    }
}

function _sourceGeometry(
    layerId: string,
    featureId: string
): { type: string; coordinates: unknown } | null {
    return _sourceFeature(layerId, featureId)?.geometry ?? null;
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
