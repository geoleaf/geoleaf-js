/*!
 * @geoleaf-plugins/measure — Types
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/** Supported measure tool identifiers. */
export type MeasureType = "distance" | "rect" | "circle" | "polygon" | "gps" | "annotation-tooltip";

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

/** Definition for a custom measure tool registered via registerMeasureType(). */
export interface MeasureTypeDef {
    cursor?: string;
    onActivate?: (map: unknown) => void;
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
    on(type: string, listener: (e: MeasureMapMouseEvent) => void): void;
    off(type: string, listener: (e: MeasureMapMouseEvent) => void): void;
    getSource(id: string): MeasureGeoJSONSource | undefined;
    addSource(id: string, source: { type: "geojson"; data: GeoJSON.FeatureCollection }): void;
    getLayer(id: string): unknown;
    addLayer(layer: Record<string, unknown>): void;
    dragPan?: { enable?(): void; disable?(): void };
    doubleClickZoom?: { enable?(): void; disable?(): void };
    __geoleafExclusiveMode?: boolean;
}
