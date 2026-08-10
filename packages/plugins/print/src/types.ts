/*!
 * @geoleaf-plugins/print — Public types
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/** Page orientation deduced from the drawn bounding rectangle. */
export type PageOrientation = "portrait" | "landscape";

/** Geographic bounding box of the map zone (WGS-84). */
export interface EmpriseBbox {
    minLng: number;
    minLat: number;
    maxLng: number;
    maxLat: number;
}

/** Generic rectangle — unit depends on context (mm in page space, px in canvas space). */
export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Page margins in millimetres. */
export interface PageMargins {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

/** Zone layout of a composed page, in mm within the page coordinate space. */
export interface PageZones {
    map: Rect;
    title: Rect;
    legend: Rect;
    footer: Rect;
}

/** Options controlling which zones are included in the composed page. */
export interface ZoneOptions {
    includeTitle: boolean;
    includeLegend: boolean;
    includeScale: boolean;
    includeNorthArrow: boolean;
    includeFooter: boolean;
}

/**
 * Definition of a paper format (A4, A3, …).
 * `widthMm` is always the short side (portrait orientation).
 */
export interface PageFormatDef {
    /** Short side in mm (portrait). */
    widthMm: number;
    /** Long side in mm (portrait). */
    heightMm: number;
    defaultMargins?: PageMargins;
    /** Computes zone layout (title / map / legend / footer) for the given orientation and options. */
    computeZones(orientation: PageOrientation, opts: ZoneOptions): PageZones;
}

/** Options for a capture operation (off-screen render). */
export interface CaptureOptions {
    format?: string;
    orientation?: PageOrientation;
    /** DPI for the off-screen render. Default: 300. */
    dpi?: number;
    /** Override centre point [lng, lat]. Default: computed from bbox or current viewport. */
    center?: [number, number];
    /**
     * Locked scale denominator — set by openPrintFlow (Sprint 5) to freeze the scale.
     * When provided, the bbox is recomputed from this scale + format rather than
     * inferred from the input extent.
     */
    scaleDenominator?: number;
}

/** Result of a capture operation (before composition). */
export interface CaptureResult {
    canvas: HTMLCanvasElement;
    dataUrl: string;
    widthPx: number;
    heightPx: number;
    bbox: EmpriseBbox;
    scaleDenominator: number;
}

/**
 * Printable annotation descriptor — produced by GeoLeaf.Measure.getPrintableAnnotations().
 * Defined here so plugin-print is self-contained (no import from plugin-measure).
 */
export interface PrintableAnnotation {
    kind: "label" | "tooltip";
    lngLat: [number, number];
    text: string;
    widthPx?: number;
    heightPx?: number;
    anchor: "bottom" | "center";
}

/** Options for a full export (capture + compose + encode). */
export interface ExportOptions {
    /** Geographic extent to render. Omit to use current viewport. */
    bbox?: EmpriseBbox;
    format?: string;
    orientation?: PageOrientation;
    dpi?: number;
    title?: string;
    description?: string;
    includeLegend?: boolean;
    includeScale?: boolean;
    includeNorthArrow?: boolean;
    /** Include measure annotations (requires plugin-measure loaded). Default: true. */
    includeAnnotations?: boolean;
    /** JPEG quality [0–1]. Default: 0.92. */
    quality?: number;
    /** Output filename (without extension). */
    filename?: string;
}

/** Options for `openPrintFlow`. */
export interface PrintFlowOptions {
    defaultFormat?: string;
    includeLegend?: boolean;
    includeScale?: boolean;
    includeNorthArrow?: boolean;
    /** Include measure annotations (requires plugin-measure loaded). Default: true. */
    includeAnnotations?: boolean;
    title?: string;
}

/** Options passed to an exporter function after composition. */
export interface ComposedExportOpts {
    format: string;
    orientation: PageOrientation;
    widthMm: number;
    heightMm: number;
    quality?: number;
    filename?: string;
}

/**
 * Custom exporter function. Receives the final composed canvas and returns a Blob.
 * Registered via `GeoLeaf.Print.registerExporter(format, fn)`.
 */
export interface ExporterFn {
    (composedCanvas: HTMLCanvasElement, opts: ComposedExportOpts): Promise<Blob>;
}

/**
 * Composition slot — allows external code to inject content at named positions
 * on the composed canvas (title, legend, footer, or overlay corners).
 * Registered via `GeoLeaf.Print.registerSlot(slot)` (Sprint 5+).
 */
export interface ComposeSlot {
    id: string;
    placement:
        | "title"
        | "legend"
        | "footer"
        | "overlay-tl"
        | "overlay-tr"
        | "overlay-bl"
        | "overlay-br";
    render(ctx: CanvasRenderingContext2D, rectPx: Rect, data: unknown): void;
}
