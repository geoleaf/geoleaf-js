/*!
 * @geoleaf-plugins/print — Off-screen map renderer
 *
 * Creates a hidden MapLibre instance sized in print pixels (mm × DPI),
 * waits for the 'idle' event, copies the canvas, and cleans up.
 *
 * Sprint 4: one-shot instances for captureExtent() / captureViewport().
 * Sprint 5: session-mode (single instance reused during the modal lifecycle).
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import type * as MaplibreGL from "maplibre-gl";
import type { CaptureOptions, CaptureResult, EmpriseBbox } from "./types.js";
import { _getNativeMap } from "./internal.js";
import { getPrintConfig } from "./config.js";
import {
    METERS_PER_PIXEL_AT_ZOOM_0,
    R_EARTH,
    ZONE_OPTS_MAP_ONLY,
    calcZoom,
    computeBbox,
    computeTargetPixels,
    computeZones,
} from "./page-format.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Screen DPI used by calculateMapScale (scale-utils.ts) to derive the scale denominator. */
const SCREEN_DPI = 96;

/**
 * Default off-screen render timeout (ms) — the backstop for a MapLibre `idle` that never comes.
 *
 * ⚠️ 180 s, and NOT 30 s — raised on 01/08/2026 (B-105). The old budget did not sit above the
 * legitimate render time, it sat INSIDE it, so the nominal path reached it and the export died
 * on hardware that merely needed to wait. A backstop the happy path can hit is not a backstop:
 * it is an intermittent failure. And this rejection does not degrade the export, it KILLS it —
 * the user gets nothing rather than a slow sheet.
 *
 * ⚠️ THE FIRST SWITCH IS THE EXPENSIVE ONE, and a single sample hides that. Measured on a
 * 2-core host (`taskset -c 0,1`, the honest model of a CI runner — see `playwright.config.js`),
 * `print:render:start` → `print:render:end` for consecutive format switches:
 *
 *     A4 → A3  (first)   109 280 ms      ← larger canvas, no tile yet cached
 *     A3 → A4              28 062 ms
 *     A4 → A3  (second)    34 819 ms      ← tiles now cached
 *
 * An earlier revision of this comment claimed the render was "bounded, around 36 s" on the
 * strength of ONE measurement — it had caught a warm switch. 90 s was then chosen against that
 * figure and proved marginal in turn: the first switch cleared it by a hair, with no timeout
 * logged. 180 s is picked against the COLD case plus margin, not against the warm one.
 *
 * ⚠️ Read this as a PER-CALL budget: `_waitForIdle` is awaited at four sites (initial render,
 * `waitReady`, `resize`, `jumpTo`), each getting the full amount. A single user action spans at
 * most one of them, so this is not a 4×180 s ceiling on one interaction.
 *
 * ⚠️ Whoever changes this must also raise the E2E wait in `e2e/14-print.spec.js`
 * (`withRenderSettled`): the two are IN SERIES. `print:render:end` is emitted from a `finally`,
 * so it fires only AFTER this budget is spent — an E2E wait equal to it can never observe the
 * event, and the suite reports an opaque wait timeout instead of the console error that says
 * what actually happened. That mistake was made here on 01/08/2026, with both set to 90 s.
 *
 * Discovered only once two E2E budgets above it were lifted — it had been masked by an
 * `actionTimeout` that failed the click first (B-103).
 */
const IDLE_TIMEOUT_MS = 180_000;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Derives the scale denominator from a MapLibre zoom + latitude.
 * Mirrors calculateMapScale (scale-utils.ts) using screenDpi=96.
 */
function _scaleFromZoom(zoom: number, lat: number): number {
    const metersPerPixel =
        (METERS_PER_PIXEL_AT_ZOOM_0 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
    return Math.round((metersPerPixel * SCREEN_DPI) / 0.0254);
}

/**
 * Converts a geographic bbox to ground dimensions in Web Mercator metres.
 * Used to infer the scale denominator from a user-provided bbox.
 */
function _bboxGroundMeters(bbox: EmpriseBbox): { widthM: number; heightM: number } {
    const R = R_EARTH;
    const xMin = R * ((bbox.minLng * Math.PI) / 180);
    const xMax = R * ((bbox.maxLng * Math.PI) / 180);
    const yMin = R * Math.log(Math.tan(Math.PI / 4 + (bbox.minLat * Math.PI) / 180 / 2));
    const yMax = R * Math.log(Math.tan(Math.PI / 4 + (bbox.maxLat * Math.PI) / 180 / 2));
    return { widthM: xMax - xMin, heightM: yMax - yMin };
}

/**
 * Infers the scale denominator from a bbox + map zone dimensions.
 * Chooses the scale that makes the entire bbox fit in the zone (larger of the two scales).
 */
function _inferScaleDenominator(
    bbox: EmpriseBbox,
    mapZoneWidthMm: number,
    mapZoneHeightMm: number
): number {
    const { widthM, heightM } = _bboxGroundMeters(bbox);
    const scaleW = (widthM * 1000) / mapZoneWidthMm;
    const scaleH = (heightM * 1000) / mapZoneHeightMm;
    return Math.round(Math.max(scaleW, scaleH));
}

/**
 * Reduces the DPI so that widthPx × heightPx ≤ maxPx (iOS/Android canvas limit).
 * Returns the original DPI if within the limit.
 */
function _boundedDpi(
    mapZoneWidthMm: number,
    mapZoneHeightMm: number,
    dpi: number,
    maxPx: number
): number {
    const w = (mapZoneWidthMm / 25.4) * dpi;
    const h = (mapZoneHeightMm / 25.4) * dpi;
    if (w * h <= maxPx) return dpi;
    const scale = Math.sqrt(maxPx / (w * h));
    return Math.floor(dpi * scale);
}

/**
 * Scales up symbol layer text-sizes for print resolution.
 * At 300 DPI, a fixed text-size:12 is ~3× smaller than on screen — multiply by dpi/96.
 * Only applies when scaleFactor > 1 (i.e. print DPI > screen DPI).
 */
async function _scaleSymbolTextSizes(map: MaplibreGL.Map, dpi: number): Promise<void> {
    const scaleFactor = dpi / SCREEN_DPI;
    if (scaleFactor <= 1) return;
    const style = map.getStyle?.() as
        | { layers?: Array<{ id: string; type: string; layout?: Record<string, unknown> }> }
        | undefined;
    let changed = false;
    for (const layer of style?.layers ?? []) {
        if (layer.type === "symbol") {
            const ts = layer.layout?.["text-size"];
            if (typeof ts === "number" && ts > 0) {
                map.setLayoutProperty(layer.id, "text-size", ts * scaleFactor);
                changed = true;
            }
        }
    }
    if (changed) {
        await new Promise<void>((resolve) => {
            // `once(type, listener)` returns the map, not a promise — MapLibre unions
            // both in one signature (maplibre-gl.d.ts:12010).
            void map.once("idle", resolve);
            setTimeout(resolve, 200);
        });
    }
}

/** Waits for MapLibre's 'idle' event; rejects after timeoutMs. */
function _waitForIdle(map: MaplibreGL.Map, timeoutMs = IDLE_TIMEOUT_MS): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error("[GeoLeaf.Print] Off-screen render timed out."));
        }, timeoutMs);
        void map.once("idle", () => {
            clearTimeout(timer);
            resolve();
        });
    });
}

/** Copies a canvas to a detached 2D canvas (avoids tainted-canvas propagation). */
function _copyCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
    const dest = document.createElement("canvas");
    dest.width = src.width;
    dest.height = src.height;
    const ctx = dest.getContext("2d");
    if (!ctx) throw new Error("[GeoLeaf.Print] Cannot get 2D context for canvas copy.");
    ctx.drawImage(src, 0, 0);
    return dest;
}

/** Dispatches a CustomEvent on document (drives the modal spinner in Sprint 5). */
function _emit(name: "print:render:start" | "print:render:end"): void {
    document.dispatchEvent(new CustomEvent(name));
}

/**
 * Creates and appends a hidden off-screen MapLibre instance.
 * The container is a fixed-positioned div placed far off-screen.
 */
function _createOffscreenInstance(
    style: unknown,
    widthPx: number,
    heightPx: number,
    center: [number, number],
    zoom: number,
    transformRequest: unknown
): { map: MaplibreGL.Map; container: HTMLElement } {
    const container = document.createElement("div");
    Object.assign(container.style, {
        position: "fixed",
        left: "-99999px",
        top: "0",
        width: `${widthPx}px`,
        height: `${heightPx}px`,
        visibility: "hidden",
        pointerEvents: "none",
    });
    document.body.appendChild(container);

    const mapOpts: Record<string, unknown> = {
        container,
        style,
        center,
        zoom,
        bearing: 0,
        pitch: 0,
        pixelRatio: 1,
        preserveDrawingBuffer: true,
        attributionControl: false,
        interactive: false,
    };
    if (transformRequest) {
        mapOpts.transformRequest = transformRequest;
    }

    // maplibre-gl is loaded as a UMD global by the host page — access via globalThis.
    const maplibre = (globalThis as unknown as { maplibregl?: typeof MaplibreGL }).maplibregl;
    if (!maplibre) throw new Error("[GeoLeaf.Print] maplibre-gl global not found.");
    // MapOptions shape varies across maplibre-gl versions; the structural cast avoids drift.
    const map = new maplibre.Map(mapOpts as MaplibreGL.MapOptions);
    return { map, container };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Re-renders the map off-screen over the given geographic extent at the
 * requested format and DPI. Returns the map zone canvas (before composition).
 *
 * If `opts.scaleDenominator` is provided (locked by the print flow), the bbox is
 * recomputed from that scale + format. Otherwise the scale is inferred from the
 * provided bbox dimensions.
 */
export async function captureExtent(
    bbox: EmpriseBbox,
    opts: CaptureOptions = {}
): Promise<CaptureResult> {
    const nativeMap = _getNativeMap();
    if (!nativeMap) throw new Error("[GeoLeaf.Print] captureExtent: map not initialised.");

    const config = getPrintConfig();
    const {
        widthPx,
        heightPx,
        centerLng,
        centerLat,
        scaleDenominator,
        renderedBbox,
        effectiveDpi,
        zoom,
    } = _resolveRenderParams(bbox, opts, config);

    _emit("print:render:start");

    let mapInst: MaplibreGL.Map | null = null;
    let containerEl: HTMLElement | null = null;

    try {
        // Clone map style and (if present) the transformRequest for tile auth.
        // Inside try so print:render:end fires even if getStyle() throws.
        const style: unknown = nativeMap.getStyle?.() ?? {};
        const transformRequest: unknown =
            (nativeMap as { _requestManager?: { _transformRequest?: unknown } })._requestManager
                ?._transformRequest ?? undefined;

        const { map, container } = _createOffscreenInstance(
            style,
            widthPx,
            heightPx,
            [centerLng, centerLat],
            zoom,
            transformRequest
        );
        mapInst = map;
        containerEl = container;

        await _waitForIdle(map);
        await _scaleSymbolTextSizes(map, effectiveDpi);

        const srcCanvas: HTMLCanvasElement = map.getCanvas();
        const destCanvas = _copyCanvas(srcCanvas);
        const dataUrl = destCanvas.toDataURL("image/jpeg", config.jpgQuality);

        return {
            canvas: destCanvas,
            dataUrl,
            widthPx,
            heightPx,
            bbox: renderedBbox,
            scaleDenominator,
        };
    } finally {
        _emit("print:render:end");
        mapInst?.remove?.();
        containerEl?.remove?.();
    }
}

/**
 * Computes the render parameters for {@link captureExtent}: zones, effective DPI
 * (mobile-clamped), centre, locked/inferred scale, rendered bbox and zoom.
 */
function _resolveRenderParams(
    bbox: EmpriseBbox,
    opts: CaptureOptions,
    config: ReturnType<typeof getPrintConfig>
) {
    const formatName = opts.format ?? config.defaultFormat;

    // Derive orientation from bbox aspect ratio if not provided
    const bboxW = bbox.maxLng - bbox.minLng;
    const bboxH = bbox.maxLat - bbox.minLat;
    const orientation = opts.orientation ?? (bboxW >= bboxH ? "landscape" : "portrait");

    const requestedDpi = opts.dpi ?? config.dpi;

    // Compute zones (no overlays at this stage — Sprint 5 modal will configure them)
    const zones = computeZones(formatName, orientation, ZONE_OPTS_MAP_ONLY);
    const mapZone = zones.map;

    // Clamp DPI to mobile canvas limit
    const isMobile = typeof navigator !== "undefined" && /Mobi|Android/i.test(navigator.userAgent);
    const effectiveDpi = isMobile
        ? _boundedDpi(mapZone.width, mapZone.height, requestedDpi, config.maxCanvasPxMobile)
        : requestedDpi;

    const { widthPx, heightPx } = computeTargetPixels(zones, effectiveDpi).map;

    // Centre from opts, bbox midpoint, or current map
    const centerLng = opts.center?.[0] ?? (bbox.minLng + bbox.maxLng) / 2;
    const centerLat = opts.center?.[1] ?? (bbox.minLat + bbox.maxLat) / 2;

    // Scale denominator: locked (from modal) or inferred from the provided bbox
    const scaleDenominator =
        opts.scaleDenominator ?? _inferScaleDenominator(bbox, mapZone.width, mapZone.height);

    // Recompute the precise rendered bbox from the locked scale + format
    const renderedBbox = computeBbox(formatName, scaleDenominator, orientation, {
        lng: centerLng,
        lat: centerLat,
    });

    const zoom = calcZoom(scaleDenominator, centerLat, effectiveDpi);

    return {
        widthPx,
        heightPx,
        centerLng,
        centerLat,
        scaleDenominator,
        renderedBbox,
        effectiveDpi,
        zoom,
    };
}

// ---------------------------------------------------------------------------
// Session mode — reused during the preview modal lifecycle (Sprint 5)
// ---------------------------------------------------------------------------

/**
 * Persistent off-screen MapLibre instance for the preview modal.
 * Created when the modal opens, destroyed on close.
 * Avoids repeated map construction (expensive) on every format/DPI change.
 */
export class OffscreenSession {
    private _map: MaplibreGL.Map | null = null;
    private _container: HTMLElement | null = null;
    private _dpi: number;

    constructor(
        style: unknown,
        transformRequest: unknown,
        widthPx: number,
        heightPx: number,
        center: [number, number],
        zoom: number,
        dpi: number = 300
    ) {
        this._dpi = dpi;
        const { map, container } = _createOffscreenInstance(
            style,
            widthPx,
            heightPx,
            center,
            zoom,
            transformRequest
        );
        this._map = map;
        this._container = container;
    }

    /** Waits for initial tiles to load after construction. Call once after new. */
    async waitReady(): Promise<void> {
        const map = this._map;
        if (!map) return;
        _emit("print:render:start");
        try {
            await _waitForIdle(map);
            await _scaleSymbolTextSizes(map, this._dpi);
        } finally {
            _emit("print:render:end");
        }
    }

    /**
     * Resizes the container then repositions the camera. Waits for idle.
     * Use when the paper format or DPI changes.
     */
    async resize(
        widthPx: number,
        heightPx: number,
        center: [number, number],
        zoom: number
    ): Promise<void> {
        if (!this._map || !this._container) return;
        _emit("print:render:start");
        try {
            Object.assign(this._container.style, {
                width: `${widthPx}px`,
                height: `${heightPx}px`,
            });
            this._map.resize();
            this._map.jumpTo({ center, zoom, bearing: 0, pitch: 0 });
            await _waitForIdle(this._map);
            await _scaleSymbolTextSizes(this._map, this._dpi);
        } finally {
            _emit("print:render:end");
        }
    }

    /** Repositions the camera without resizing. Waits for idle. */
    async jumpTo(center: [number, number], zoom: number): Promise<void> {
        if (!this._map) return;
        _emit("print:render:start");
        try {
            this._map.jumpTo({ center, zoom, bearing: 0, pitch: 0 });
            await _waitForIdle(this._map);
        } finally {
            _emit("print:render:end");
        }
    }

    /** Returns a copy of the current off-screen canvas (safe for 2D composition). */
    getCanvas(): HTMLCanvasElement {
        if (!this._map) throw new Error("[GeoLeaf.Print] OffscreenSession: map not ready.");
        return _copyCanvas(this._map.getCanvas());
    }

    /** Destroys the map instance and removes the container. Call on modal close. */
    destroy(): void {
        this._map?.remove?.();
        this._container?.remove?.();
        this._map = null;
        this._container = null;
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Reads a bbox from a MapLibre `LngLatBounds` (with legacy _sw/_ne fallback). */
function _bboxFromBounds(bounds: MaplibreGL.LngLatBounds): EmpriseBbox {
    // Legacy maplibre exposed the corners as _sw/_ne; v5 uses the getter API.
    const legacy = bounds as unknown as {
        _sw?: { lng: number; lat: number };
        _ne?: { lng: number; lat: number };
    };
    return {
        minLng: bounds.getWest?.() ?? legacy._sw?.lng ?? 0,
        minLat: bounds.getSouth?.() ?? legacy._sw?.lat ?? 0,
        maxLng: bounds.getEast?.() ?? legacy._ne?.lng ?? 0,
        maxLat: bounds.getNorth?.() ?? legacy._ne?.lat ?? 0,
    };
}

/**
 * Captures the current viewport extent (format from config, A4 by default).
 * The scale denominator is read from the live map at capture time.
 */
export async function captureViewport(opts: CaptureOptions = {}): Promise<CaptureResult> {
    const nativeMap = _getNativeMap();
    if (!nativeMap) throw new Error("[GeoLeaf.Print] captureViewport: map not initialised.");

    const bounds = nativeMap.getBounds?.();
    if (!bounds) throw new Error("[GeoLeaf.Print] captureViewport: could not get map bounds.");

    // API publique `LngLatBounds` (avec repli legacy _sw/_ne)
    const bbox = _bboxFromBounds(bounds);

    // Lock the current map scale for the viewport capture
    const zoom: number = nativeMap.getZoom?.() ?? 12;
    const center = nativeMap.getCenter?.();
    const lat: number = center?.lat ?? 0;
    const lockedScale = _scaleFromZoom(zoom, lat);

    return captureExtent(bbox, { ...opts, scaleDenominator: lockedScale });
}
