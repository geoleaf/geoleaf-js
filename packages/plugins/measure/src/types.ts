/*!
 * @geoleaf-plugins/measure — Types
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/** Supported measure tool identifiers. */
export type MeasureType = "distance" | "rect" | "circle" | "polygon" | "gps" | "annotation-tooltip";

/**
 * A tool identifier as the arming path accepts it: one of the six built-ins, or the id of a
 * tool registered through `registerMeasureType()`.
 *
 * The `string & Record<never, never>` half is what keeps editor autocompletion listing the six
 * literals — a plain `MeasureType | string` collapses to `string` and the suggestions vanish.
 *
 * ⚠️ **Not the same set as `MeasureConfig.enabledTools`, and deliberately so.** That one stays
 * `MeasureType[]`: it filters the BUTTONS of the floating menu, which are built from a static
 * table carrying an icon and i18n keys. A custom tool has neither, so it has no button to
 * filter — it is armed by `GeoLeaf.Measure.startMeasure(id)` from the integrator's own UI.
 */
export type MeasureToolId = MeasureType | (string & Record<never, never>);

/** Supported distance units. */
export type DistanceUnit = "m" | "km" | "auto";

/** Supported area units. */
export type AreaUnit = "m2" | "ha" | "km2" | "auto";

/** Active unit selection. */
export interface Units {
    distance: DistanceUnit;
    area: AreaUnit;
}

/** A single measured feature stored in the FeatureCollection. */
export interface MeasureFeature {
    type: "Feature";
    geometry: GeoJSON.Geometry;
    properties: {
        measureType: MeasureType | string;
        lengthM?: number;
        perimeterM?: number;
        areaM2?: number;
        radiusM?: number;
        label?: string;
        annotationKind?: "label" | "tooltip";
        widthPx?: number;
        heightPx?: number;
        createdAt: string;
        [key: string]: unknown;
    };
}

/** Active drawing session shared between measure-engine and tool modules. */
export interface MeasureSession {
    type: "line" | "polygon";
    vertices: [number, number][];
    closed: boolean;
}

/** Plugin configuration after merging defaults with profile values. */
export interface MeasureConfig {
    enabled: boolean;
    showButton: boolean;
    position: string;
    /**
     * Initial position of the floating sub-menu: an explicit viewport-pixel pair, or the
     * literal `"top-left"`.
     *
     * Deliberately NOT a free `string` (PLUGINS S5). It used to be, which made the type
     * promise a corner vocabulary the code never implemented: `_applyPosition` mapped
     * every string it did not recognise onto the top-left default, so `"bottom-right"`
     * rendered top-left with no error. The default being `"top-left"` is what kept the
     * bug invisible. Widening this again means implementing the mapping first.
     */
    menuPosition: "top-left" | { top: number; left: number };
    defaultDistanceUnit: DistanceUnit;
    defaultAreaUnit: AreaUnit;
    snapPx: number;
    circleSteps: number;
    enabledTools: MeasureType[];
    tooltipDefaultSize: { width: number; height: number };
    labelMaxChars: number;
    persist: boolean;
    storageKey: string;
    maxFeatures: number;
    gpsCloseThresholdM: number;
    gpsMaxJumpMps: number;
    decimals: { distance: number; area: number };
    exportFileName: string;
    [key: string]: unknown;
}

/**
 * Definition for a custom measure tool registered via `registerMeasureType()`.
 *
 * Every field is optional: a definition with none of them is still armable, it simply gets the
 * default crosshair and does nothing of its own. The plugin owns the envelope around these
 * callbacks — exclusive mode, cursor, and the cursor guard — because none of those three
 * primitives is reachable from `onActivate`, and a tool that skipped them would have its
 * cursor stolen by the core's hover handlers.
 */
export interface MeasureTypeDef {
    /** CSS cursor shown while the tool is armed. Defaults to `"crosshair"`. */
    cursor?: string;
    /**
     * Called once the envelope is in place. Receives the native map — typed `unknown` because
     * the engine handle is not part of this package's public surface.
     */
    onActivate?: (map: unknown) => void;
    /**
     * Called before the envelope is torn down. Receives nothing: close over whatever the
     * activation needed.
     */
    onDeactivate?: () => void;
}

/** Printable annotation descriptor returned by getPrintableAnnotations(). */
export interface PrintableAnnotation {
    kind: "label" | "tooltip";
    lngLat: [number, number];
    text: string;
    widthPx?: number;
    heightPx?: number;
    anchor: "bottom" | "center";
}

// ---------------------------------------------------------------------------
// MapLibre runtime frontier — structural subset used across the plugin.
// The measure plugin stays MapLibre-agnostic (no value import of maplibre-gl):
// these interfaces narrow the `unknown` returned by
// GeoLeaf.Core.getMap().getNativeMap() at the single seam (internal._getNativeMap).
// Only the members actually used are declared. Precision grows if needed.
// ---------------------------------------------------------------------------

/** Screen pixel coordinate returned by {@link MeasureMap.project}. */
export interface MeasurePoint {
    x: number;
    y: number;
}

/** Geographic coordinate (MapLibre `LngLat` subset) from unproject / carried by events. */
export interface MeasureLngLat {
    lng: number;
    lat: number;
    toArray(): [number, number];
}

/** Map pointer event surface consumed by the tools (MapLibre `MapMouseEvent` subset). */
export interface MeasureMapMouseEvent {
    lngLat: MeasureLngLat;
    /** Underlying DOM event (used for the mouse button check in circle/rect drags). */
    originalEvent?: MouseEvent;
    preventDefault?(): void;
}

/**
 * Map touch event surface (MapLibre `MapTouchEvent` subset), used by the drag tools.
 *
 * ⚠️ `lngLat` is valid on `touchend` too: MapLibre builds it from `changedTouches` for
 * that type and from `touches` otherwise — so the end of a gesture still carries a
 * position even though `touches` is empty by then.
 *
 * `points` is the per-finger list, and it is what the single-finger guard reads: a
 * pinch must keep reaching MapLibre's own zoom/rotate handler rather than being eaten
 * as a botched draw.
 */
export interface MeasureMapTouchEvent {
    lngLat: MeasureLngLat;
    points?: MeasurePoint[];
    originalEvent?: TouchEvent;
    preventDefault?(): void;
}

/** GeoJSON source handle (MapLibre `GeoJSONSource` subset). */
export interface MeasureGeoJSONSource {
    setData(data: GeoJSON.FeatureCollection): void;
}

/**
 * Structural subset of the native MapLibre map used across the measure plugin.
 * `__geoleafExclusiveMode` is a custom GeoLeaf flag set on the map instance by the
 * tools (not a MapLibre member). Interaction handlers (`dragPan`, `doubleClickZoom`)
 * are optional-chained at call sites, hence optional here.
 */
export interface MeasureMap {
    project(lngLat: [number, number] | { lng: number; lat: number }): MeasurePoint;
    unproject(point: [number, number]): MeasureLngLat;
    getContainer(): HTMLElement;
    getCanvas(): HTMLCanvasElement;
    // Overloads rather than a union parameter: `on("mousedown", …)` and `on("touchstart", …)`
    // are the same MapLibre method, and the drag tools now use both. Every existing mouse
    // call site keeps resolving to the first signature, so nothing needs a cast.
    on(type: string, listener: (e: MeasureMapMouseEvent) => void): void;
    on(type: string, listener: (e: MeasureMapTouchEvent) => void): void;
    off(type: string, listener: (e: MeasureMapMouseEvent) => void): void;
    off(type: string, listener: (e: MeasureMapTouchEvent) => void): void;
    getSource(id: string): MeasureGeoJSONSource | undefined;
    addSource(id: string, source: { type: "geojson"; data: GeoJSON.FeatureCollection }): void;
    getLayer(id: string): unknown;
    addLayer(layer: Record<string, unknown>): void;
    dragPan?: { enable?(): void; disable?(): void };
    doubleClickZoom?: { enable?(): void; disable?(): void };
    __geoleafExclusiveMode?: boolean;
}
