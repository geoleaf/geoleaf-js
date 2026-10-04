/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * MapLibre Hatch Pattern Generator
 *
 * Generates Canvas-based hatch pattern images for use with MapLibre's
 * `fill-pattern` paint property. Replaces the SVG-based approach used
 * (Canvas API avoids DOM injection and MutationObservers).
 *
 * Supported hatch types: `diagonal`, `dot`, `cross`, `x`, `horizontal`, `vertical`.
 *
 * Usage:
 * 1. Call `generateHatchImage()` to get an `ImageData` object.
 * 2. Register it with MapLibre: `map.addImage(patternId, imageData, { pixelRatio })`.
 * 3. Set the fill layer paint: `{ "fill-pattern": patternId }`.
 */

import type { MaplibreMap } from "./maplibre-adapter-types.js";

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Parameters of a hatch fill pattern, rendered to an image and registered with the map.
 *
 * Hatching is not a MapLibre paint property: the pattern is drawn to a canvas and added as an
 * image, which is why a hatched layer needs the map's style to be loaded before it can paint.
 */
export interface HatchConfig {
    /** Whether hatch is enabled. */
    enabled?: boolean;
    /** Hatch type. @default "diagonal" */
    type?: "diagonal" | "dot" | "cross" | "x" | "horizontal" | "vertical";
    /** Rotation angle in degrees (for diagonal). @default 45 */
    angleDeg?: number;
    /** Spacing between pattern elements in pixels. @default 10 */
    spacingPx?: number;
    /** Stroke styling for the hatch lines/dots. */
    stroke?: {
        color?: string;
        widthPx?: number;
        opacity?: number;
    };
    /** Fill render mode. "pattern_only" = no base fill, pattern only. */
    renderMode?: string;
}

// ─── Pattern generation ──────────────────────────────────────────────────────

/** Default pixel ratio for retina displays. */
const DEFAULT_PIXEL_RATIO = 2;

/**
 * Generates a hatch pattern as an `ImageData` object for MapLibre.
 *
 * @param hatchConfig - Hatch configuration from the GeoLeaf style.
 * @param pixelRatio - Device pixel ratio for sharp rendering. @default 2
 * @returns `{ imageData, width, height, pixelRatio }` ready for `map.addImage()`.
 */
export function generateHatchImage(
    hatchConfig: HatchConfig,
    pixelRatio: number = DEFAULT_PIXEL_RATIO
): { imageData: ImageData; width: number; height: number; pixelRatio: number } {
    const type = hatchConfig.type ?? "diagonal";
    const spacing = (hatchConfig.spacingPx ?? 10) * pixelRatio;
    const color = hatchConfig.stroke?.color ?? "#000000";
    const strokeWidth = (hatchConfig.stroke?.widthPx ?? 1) * pixelRatio;
    const strokeOpacity = hatchConfig.stroke?.opacity ?? 1;

    const size = Math.max(4, Math.ceil(spacing));
    // OffscreenCanvas and HTMLCanvasElement expose structurally-compatible 2D
    // contexts for the draw ops used here; treat the surface as a DOM canvas so
    // the helpers receive the `CanvasRenderingContext2D` they expect.
    const canvas = _createCanvas(size, size) as HTMLCanvasElement;
    const ctx = canvas.getContext("2d")!;

    // Clear to transparent
    ctx.clearRect(0, 0, size, size);

    // Set drawing style
    ctx.strokeStyle = color;
    ctx.lineWidth = strokeWidth;
    ctx.globalAlpha = strokeOpacity;
    ctx.fillStyle = color;
    ctx.lineCap = "square";

    switch (type) {
        case "diagonal":
            _drawDiagonal(ctx, size, hatchConfig.angleDeg);
            break;
        case "dot":
            _drawDot(ctx, size, spacing, pixelRatio);
            break;
        case "cross":
            _drawCross(ctx, size);
            break;
        case "x":
            _drawX(ctx, size);
            break;
        case "horizontal":
            _drawHorizontal(ctx, size);
            break;
        case "vertical":
            _drawVertical(ctx, size);
            break;
    }

    const imageData = ctx.getImageData(0, 0, size, size);
    return { imageData, width: size, height: size, pixelRatio };
}

/** Prefix of every hatch pattern id. */
const HATCH_ID_PREFIX = "gl-hatch-";

/**
 * Builds a unique pattern ID for a hatch configuration.
 * Deterministic — same config always produces the same ID.
 */
export function buildHatchPatternId(layerId: string, hatchConfig: HatchConfig): string {
    const type = hatchConfig.type ?? "diagonal";
    const angle = hatchConfig.angleDeg ?? 0;
    const spacing = hatchConfig.spacingPx ?? 10;
    const color = (hatchConfig.stroke?.color ?? "#000000").replace("#", "");
    const sw = hatchConfig.stroke?.widthPx ?? 1;
    const op = hatchConfig.stroke?.opacity ?? 1;
    return `${HATCH_ID_PREFIX}${layerId}-${type}-${angle}-${spacing}-${color}-${sw}-${op}`;
}

// ─── Registered patterns ─────────────────────────────────────────────────────

/** What it takes to draw a pattern again. */
interface RegisteredHatch {
    hatchConfig: HatchConfig;
    pixelRatio: number;
}

/**
 * The patterns registered on each map, by pattern id — kept so that they can be drawn again.
 *
 * An image is not part of the style. A basemap switch the engine can DIFF keeps its image
 * store, and the patterns with it. When the diff fails the engine rebuilds the style from
 * scratch, with an empty store: the fill layers carried into the new style then name patterns
 * that no longer exist, and a `pattern_only` fill draws nothing at all.
 *
 * Keyed weakly by the map, so a destroyed map takes its entries with it.
 */
const _registered = new WeakMap<object, Map<string, RegisteredHatch>>();

/** Draws a pattern and hands it to the map. */
function _addHatchImage(map: MaplibreMap, patternId: string, hatch: RegisteredHatch): void {
    const { imageData, width, height, pixelRatio } = generateHatchImage(
        hatch.hatchConfig,
        hatch.pixelRatio
    );
    map.addImage(patternId, { data: imageData.data, width, height }, { pixelRatio });
}

/**
 * Registers a hatch pattern image on a MapLibre map instance, and remembers it so that
 * {@link reregisterHatchPatterns} can draw it again.
 *
 * @param mapArg - The map. Typed `unknown` and named `mapArg` because cross-module callers
 *   (geojson, vector-tiles) pass a permissive structural view; the runtime value is always the
 *   native `maplibregl.Map`.
 * @param patternId - Unique pattern ID (from `buildHatchPatternId`).
 * @param hatchConfig - Hatch configuration.
 * @param pixelRatio - Device pixel ratio. @default 2
 * @returns The pattern ID (for use in `fill-pattern`).
 */
export function registerHatchPattern(
    mapArg: unknown,
    patternId: string,
    hatchConfig: HatchConfig,
    pixelRatio: number = DEFAULT_PIXEL_RATIO
): string {
    // Cross-module callers (geojson/vector-tiles) pass a permissive structural
    // map view; the runtime value is always the native MapLibre map.
    const map = mapArg as MaplibreMap;
    const hatch: RegisteredHatch = { hatchConfig, pixelRatio };
    // Remembered BEFORE the early return below: a pattern the map already holds must be
    // re-drawable too, or the first layer to register it would be the only one that counts.
    let patterns = _registered.get(map);
    if (!patterns) {
        patterns = new Map<string, RegisteredHatch>();
        _registered.set(map, patterns);
    }
    patterns.set(patternId, hatch);
    // Skip if already registered
    if (map.hasImage(patternId)) return patternId;

    _addHatchImage(map, patternId, hatch);
    return patternId;
}

/**
 * Puts back the registered hatch patterns the map no longer holds.
 *
 * Meant for the moment a style has just been replaced. After a rebuild from scratch the image
 * store is empty, and every pattern registered through {@link registerHatchPattern} is drawn
 * again; after a diff the patterns are still there, and this does nothing.
 *
 * @param mapArg - The map (see {@link registerHatchPattern}).
 * @returns How many patterns were put back.
 */
export function reregisterHatchPatterns(mapArg: unknown): number {
    const map = mapArg as MaplibreMap;
    const patterns = _registered.get(map);
    if (!patterns) return 0;
    let restored = 0;
    for (const [patternId, hatch] of patterns) {
        if (map.hasImage(patternId)) continue;
        _addHatchImage(map, patternId, hatch);
        restored += 1;
    }
    return restored;
}

/**
 * Removes a layer's hatch patterns from the map, and forgets them.
 *
 * Both halves matter: a pattern taken off the map but still remembered would be drawn again
 * by {@link reregisterHatchPatterns} at the next style change, for a layer that is gone.
 *
 * ⚠️ BY PREFIX (`gl-hatch-<layerId>-`), on both halves alike. The images are read off
 * `listImages()`, the engine's PUBLIC enumeration — this once read `map.style._images`, an
 * engine-private field: it worked, but nothing contractual guaranteed it across versions. An
 * engine without `listImages()` keeps its images; the patterns are forgotten regardless.
 *
 * @param mapArg - The map (see {@link registerHatchPattern}).
 * @param layerId - The GeoLeaf layer whose patterns go.
 */
export function removeHatchPatterns(mapArg: unknown, layerId: string): void {
    const map = mapArg as MaplibreMap;
    const prefix = `${HATCH_ID_PREFIX}${layerId}-`;
    if (typeof map.listImages === "function") {
        for (const imageId of map.listImages()) {
            if (imageId.startsWith(prefix)) map.removeImage(imageId);
        }
    }
    const patterns = _registered.get(map);
    if (!patterns) return;
    for (const patternId of [...patterns.keys()]) {
        if (patternId.startsWith(prefix)) patterns.delete(patternId);
    }
}

// ─── Canvas helpers ──────────────────────────────────────────────────────────

/**
 * Creates an offscreen canvas — OffscreenCanvas when it can actually hand out a 2D context,
 * fallback to DOM otherwise.
 *
 * ⚠️ The guard tests USABILITY, not existence. An environment can expose the constructor and
 * still return `null` from `getContext("2d")` for want of a 2D backend (happy-dom ≥ 20.11.0
 * does exactly this without a `canvasAdapter`). {@link generateHatchImage} asserts the context
 * non-null, so existence-only detection turned that case into a `TypeError`. Measured
 * 15/08/2026. Repeating `getContext("2d")` on one surface returns the same
 * context — the probe is free and side-effect-free.
 */
function _createCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
    if (typeof OffscreenCanvas !== "undefined") {
        const offscreen = new OffscreenCanvas(width, height);
        if (offscreen.getContext("2d")) return offscreen;
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
}

/** Diagonal lines from bottom-left to top-right. */
function _drawDiagonal(ctx: CanvasRenderingContext2D, size: number, angleDeg?: number): void {
    const angle = angleDeg ?? 45;
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate((angle * Math.PI) / 180);
    ctx.translate(-size / 2, -size / 2);

    // Draw lines that cover the rotated tile with margin
    const extent = size * 2;
    for (let i = -extent; i < extent; i += size) {
        ctx.beginPath();
        ctx.moveTo(i, -extent);
        ctx.lineTo(i, extent);
        ctx.stroke();
    }
    ctx.restore();
}

/** Dot pattern (filled circles at center of each tile). */
function _drawDot(
    ctx: CanvasRenderingContext2D,
    size: number,
    spacing: number,
    pixelRatio: number
): void {
    const radius = Math.max(0.5 * pixelRatio, spacing * 0.07);
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, radius, 0, Math.PI * 2);
    ctx.fill();
}

/** Cross pattern: horizontal + vertical lines through center. */
function _drawCross(ctx: CanvasRenderingContext2D, size: number): void {
    const half = size / 2;
    ctx.beginPath();
    ctx.moveTo(0, half);
    ctx.lineTo(size, half);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(half, 0);
    ctx.lineTo(half, size);
    ctx.stroke();
}

/** X pattern: two diagonal lines corner-to-corner. */
function _drawX(ctx: CanvasRenderingContext2D, size: number): void {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(size, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(size, 0);
    ctx.lineTo(0, size);
    ctx.stroke();
}

/** Single horizontal line through center. */
function _drawHorizontal(ctx: CanvasRenderingContext2D, size: number): void {
    const half = size / 2;
    ctx.beginPath();
    ctx.moveTo(0, half);
    ctx.lineTo(size, half);
    ctx.stroke();
}

/** Single vertical line through center. */
function _drawVertical(ctx: CanvasRenderingContext2D, size: number): void {
    const half = size / 2;
    ctx.beginPath();
    ctx.moveTo(half, 0);
    ctx.lineTo(half, size);
    ctx.stroke();
}
