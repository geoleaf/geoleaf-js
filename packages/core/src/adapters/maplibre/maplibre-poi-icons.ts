/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * MapLibre POI Icon Registrar
 *
 * Converts each SVG `<symbol>` from the injected profile sprite into a
 * Canvas-rendered `ImageData` and registers it with MapLibre via `map.addImage()`.
 *
 * Rendering strategy: direct canvas 2D API — reads the DOM `<symbol>` children
 * (`<path>`, `<circle>`, `<line>`, etc.) and renders them with `Path2D` and
 * `ctx.arc()`. This avoids loading the SVG as an `<img>` element, which is
 * unreliable in Chrome for stroke-only SVGs (known blank-canvas issue) and is
 * subject to `img-src` CSP restrictions.
 */

import { Log } from "../../utils/log/index.js";
import { getGeoLeaf } from "../../utils/general/geoleaf-global.js";
import { ensureProfileSpriteInjectedSync } from "../../utils/loaders/profile-sprite-loader.js";
import type { MaplibreMap } from "./maplibre-adapter-types.js";
// Type-only — erased at build time, so it opens no import cycle with the taxonomy
// capability (which imports this module for `ensureSprite`).
import type { TaxonomyIconVariant } from "../../capabilities/taxonomy/types.js";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Logical icon size in pixels (before pixel ratio scaling). */
const ICON_SIZE_PX = 24;

/** Pixel ratio for retina-sharp icon rendering. */
const ICON_PIXEL_RATIO = 2;

/**
 * Colour a `currentColor` glyph is rasterised with when the taxonomy declares no
 * `iconColor`. White — what this pipeline has always baked in.
 */
const DEFAULT_TINT = "white";

/** Guard against a `<use>` chain that references itself. */
const MAX_USE_DEPTH = 4;

// ─── Canvas helpers ──────────────────────────────────────────────────────────

function _createCanvas(width: number, height: number): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
}

function _getAttrFloat(el: Element, name: string, fallback: number): number {
    const v = Number.parseFloat(el.getAttribute(name) ?? "");
    return Number.isNaN(v) ? fallback : v;
}

// ─── Color resolution ────────────────────────────────────────────────────────
// `currentColor` is the sprite's way of saying "whoever draws me picks the colour".
// On a canvas there is no cascade to inherit from, so the caller's tint stands in
// for it. Explicit colours in the SVG are left alone — that is what keeps
// multi-colour symbols multi-colour.

function _resolveColor(raw: string | null, parent: string, tint: string): string {
    if (!raw) return parent;
    if (raw === "currentColor") return tint;
    return raw;
}

function _resolveFill(raw: string | null, parent: string | null, tint: string): string | null {
    if (!raw) return parent;
    if (raw === "none") return null;
    if (raw === "currentColor") return tint;
    return raw;
}

// ─── Per-shape renderers ─────────────────────────────────────────────────────

function _renderPath(
    ctx: CanvasRenderingContext2D,
    el: Element,
    stroke: string | null,
    fill: string | null
): void {
    const d = el.getAttribute("d");
    if (!d) return;
    const path = new Path2D(d);
    if (fill) ctx.fill(path);
    if (stroke) ctx.stroke(path);
}

function _renderCircle(
    ctx: CanvasRenderingContext2D,
    el: Element,
    stroke: string | null,
    fill: string | null
): void {
    ctx.beginPath();
    ctx.arc(
        _getAttrFloat(el, "cx", 0),
        _getAttrFloat(el, "cy", 0),
        _getAttrFloat(el, "r", 0),
        0,
        Math.PI * 2
    );
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
}

function _renderLine(ctx: CanvasRenderingContext2D, el: Element, stroke: string | null): void {
    ctx.beginPath();
    ctx.moveTo(_getAttrFloat(el, "x1", 0), _getAttrFloat(el, "y1", 0));
    ctx.lineTo(_getAttrFloat(el, "x2", 0), _getAttrFloat(el, "y2", 0));
    if (stroke) ctx.stroke();
}

function _renderPoly(
    ctx: CanvasRenderingContext2D,
    el: Element,
    tag: string,
    stroke: string | null,
    fill: string | null
): void {
    const pts = (el.getAttribute("points") ?? "")
        .trim()
        .split(/[\s,]+/)
        .map(Number);
    if (pts.length < 4) return;
    ctx.beginPath();
    const [x0 = 0, y0 = 0] = pts;
    ctx.moveTo(x0, y0);
    for (let i = 2; i < pts.length - 1; i += 2) ctx.lineTo(pts[i] ?? 0, pts[i + 1] ?? 0);
    if (tag === "polygon") ctx.closePath();
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
}

function _renderRect(
    ctx: CanvasRenderingContext2D,
    el: Element,
    stroke: string | null,
    fill: string | null
): void {
    const x = _getAttrFloat(el, "x", 0);
    const y = _getAttrFloat(el, "y", 0);
    const w = _getAttrFloat(el, "width", 0);
    const h = _getAttrFloat(el, "height", 0);
    if (fill) ctx.fillRect(x, y, w, h);
    if (stroke) ctx.strokeRect(x, y, w, h);
}

function _renderEllipse(
    ctx: CanvasRenderingContext2D,
    el: Element,
    stroke: string | null,
    fill: string | null
): void {
    ctx.beginPath();
    ctx.ellipse(
        _getAttrFloat(el, "cx", 0),
        _getAttrFloat(el, "cy", 0),
        _getAttrFloat(el, "rx", 0),
        _getAttrFloat(el, "ry", 0),
        0,
        0,
        Math.PI * 2
    );
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
}

// ─── SVG element dispatcher ──────────────────────────────────────────────────

/** Rendering context threaded through the recursive walk. */
interface RenderCtx {
    /** The colour `currentColor` resolves to. */
    tint: string;
    /** The sprite `<svg>` root, needed to resolve `<use href="#…">` targets. */
    root: Element | null;
    /** Recursion depth, to survive a self-referencing `<use>` chain. */
    depth: number;
}

/**
 * Renders a `<use href="#target">` by drawing the referenced element's children.
 *
 * Without this, a `<use>` renders as nothing: the canvas walk only knows the
 * primitive shapes. Sprites lean on `<use>` for aliases — `sprite_rail.svg` maps
 * `…-gare_tgv` onto a shared glyph that way — so a profile binding such an id
 * would get an icon in its popup (the DOM `<use>` resolves fine) and a blank on
 * the map. Resolving it here fixes both the raw and the tinted passes.
 */
function _renderUse(ctx: CanvasRenderingContext2D, el: Element, rctx: RenderCtx): void {
    if (!rctx.root || rctx.depth >= MAX_USE_DEPTH) return;

    const href = el.getAttribute("href") ?? el.getAttribute("xlink:href");
    if (!href || !href.startsWith("#")) return;

    const targetId = href.slice(1);
    // Attribute selector rather than getElementById: the sprite root may be a
    // detached element, and ids are profile-authored data.
    const target = rctx.root.querySelector(`[id="${CSS.escape(targetId)}"]`);
    if (!target) return;

    const deeper: RenderCtx = { ...rctx, depth: rctx.depth + 1 };
    const stroke = _resolveColor(target.getAttribute("stroke"), rctx.tint, rctx.tint);
    const fill = _resolveFill(target.getAttribute("fill"), null, rctx.tint);
    for (const child of Array.from(target.children)) {
        _renderSvgElement(ctx, child, stroke, fill, deeper);
    }
}

/**
 * Renders one SVG child element onto a canvas 2D context.
 * Coordinates are in the symbol's viewBox units — caller must apply `ctx.scale()`.
 */
function _renderSvgElement(
    ctx: CanvasRenderingContext2D,
    el: Element,
    parentStroke: string,
    parentFill: string | null,
    rctx: RenderCtx
): void {
    const tag = el.tagName.toLowerCase();

    if (tag === "use") {
        _renderUse(ctx, el, rctx);
        return;
    }

    const stroke = _resolveColor(el.getAttribute("stroke"), parentStroke, rctx.tint);
    const fill = _resolveFill(el.getAttribute("fill"), parentFill, rctx.tint);

    if (stroke) ctx.strokeStyle = stroke;
    if (fill) ctx.fillStyle = fill;

    if (tag === "path") {
        _renderPath(ctx, el, stroke, fill);
        return;
    }
    if (tag === "circle") {
        _renderCircle(ctx, el, stroke, fill);
        return;
    }
    if (tag === "line") {
        _renderLine(ctx, el, stroke);
        return;
    }
    if (tag === "polyline" || tag === "polygon") {
        _renderPoly(ctx, el, tag, stroke, fill);
        return;
    }
    if (tag === "rect") {
        _renderRect(ctx, el, stroke, fill);
        return;
    }
    if (tag === "g") {
        for (const child of Array.from(el.children)) {
            _renderSvgElement(ctx, child, stroke, fill, rctx);
        }
        return;
    }
    if (tag === "ellipse") _renderEllipse(ctx, el, stroke, fill);
}

// ─── Symbol rendering ─────────────────────────────────────────────────────────

/**
 * Renders a `<symbol>` DOM element directly to `ImageData` using the canvas 2D API.
 * Synchronous — no URL, no CSP, no browser timing dependency.
 *
 * @param symbolEl - The `<symbol>` element to rasterise.
 * @param canvasSize - Side of the square canvas, in pixels; the icon is drawn to fill it.
 * @param tint - The colour `currentColor` resolves to. Defaults to white, which is
 *   what every icon rendered as before taxonomy could tint them.
 * @param root - The sprite `<svg>` root, so `<use href="#…">` children can resolve.
 */
function _renderSymbolToImageData(
    symbolEl: Element,
    canvasSize: number,
    tint: string = DEFAULT_TINT,
    root: Element | null = null
): ImageData | null {
    const canvas = _createCanvas(canvasSize, canvasSize);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const vb = (symbolEl.getAttribute("viewBox") ?? "0 0 24 24").split(" ").map(Number);
    const scaleX = canvasSize / (vb[2] || 24);
    const scaleY = canvasSize / (vb[3] || 24);

    const stroke = _resolveColor(symbolEl.getAttribute("stroke"), tint, tint);
    const fill = _resolveFill(symbolEl.getAttribute("fill"), null, tint);

    ctx.save();
    ctx.scale(scaleX, scaleY);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = Number.parseFloat(symbolEl.getAttribute("stroke-width") ?? "1.7");
    ctx.lineCap = (symbolEl.getAttribute("stroke-linecap") ?? "round") as CanvasLineCap;
    ctx.lineJoin = (symbolEl.getAttribute("stroke-linejoin") ?? "round") as CanvasLineJoin;
    if (fill) ctx.fillStyle = fill;

    const rctx: RenderCtx = { tint, root, depth: 0 };
    for (const child of Array.from(symbolEl.children)) {
        _renderSvgElement(ctx, child, stroke, fill, rctx);
    }
    ctx.restore();

    const imageData = ctx.getImageData(0, 0, canvasSize, canvasSize);
    const hasPixels = imageData.data.some((v, i) => i % 4 === 3 && v > 0);
    if (!hasPixels) {
        if (Log) Log.warn("[POI] registerSpriteIcons: canvas empty after direct render");
        return null;
    }
    return imageData;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns true when every child of the symbol is a `<use>` element.
 * These are alias symbols whose `<use href="#...">` targets are not available
 * when iterating children — skip them; the real symbols are registered directly.
 */
function _isAliasSymbol(symbol: Element): boolean {
    const children = Array.from(symbol.children);
    return children.length > 0 && children.every((c) => c.tagName.toLowerCase() === "use");
}

function _tryAddImage(
    map: MaplibreMap,
    id: string,
    imageData: ImageData,
    canvasSize: number
): boolean {
    try {
        map.addImage(
            id,
            { data: imageData.data, width: canvasSize, height: canvasSize },
            { pixelRatio: ICON_PIXEL_RATIO }
        );
        return true;
    } catch (err) {
        if (Log) Log.warn(`[POI] registerSpriteIcons: map.addImage failed for "${id}":`, err);
        return false;
    }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Renders and registers one symbol, untinted. Returns true if newly registered. */
function _processSymbol(
    map: MaplibreMap,
    symbol: Element,
    canvasSize: number,
    root: Element
): boolean {
    const id = symbol.getAttribute("id");
    if (!id || map.hasImage(id)) return false;
    if (_isAliasSymbol(symbol)) return false;

    const imageData = _renderSymbolToImageData(symbol, canvasSize, DEFAULT_TINT, root);
    if (!imageData) {
        if (Log) Log.warn(`[POI] registerSpriteIcons: failed to render "${id}"`);
        return false;
    }
    return _tryAddImage(map, id, imageData, canvasSize);
}

/**
 * Renders and registers one TINTED variant. Returns true if newly registered.
 *
 * Unlike the raw pass this does not skip alias symbols: the config explicitly
 * asked for this icon, so its `<use>` chain is resolved (see `_renderUse`).
 */
function _processVariant(
    map: MaplibreMap,
    variant: TaxonomyIconVariant,
    canvasSize: number,
    root: Element,
    symbolPrefix: string
): boolean {
    if (map.hasImage(variant.symbolId)) return false;

    // The `<symbol>` ids in the sprite already carry the profile's prefix, while a
    // config `svgId` does not — hence the prefix here.
    const sourceId = symbolPrefix + variant.svgId;
    const symbol = root.querySelector(`symbol[id="${CSS.escape(sourceId)}"]`);
    if (!symbol) {
        if (Log)
            Log.warn(
                `[POI] registerSpriteIcons: sprite has no symbol "${sourceId}" for tinted variant "${variant.symbolId}"`
            );
        return false;
    }

    const imageData = _renderSymbolToImageData(symbol, canvasSize, variant.color, root);
    if (!imageData) {
        if (Log) Log.warn(`[POI] registerSpriteIcons: failed to render "${variant.symbolId}"`);
        return false;
    }
    return _tryAddImage(map, variant.symbolId, imageData, canvasSize);
}

/**
 * Reads the (icon × tint) pairs the taxonomy config references, through the runtime
 * seam. Never a static import: `taxonomy/public-api.ts` already imports THIS module
 * (for `ensureSprite`), so importing it back would close a cycle.
 */
function _getTaxonomyIconVariants(): TaxonomyIconVariant[] {
    const gl = getGeoLeaf() as { Taxonomy?: { getIconVariants?: () => TaxonomyIconVariant[] } };
    return gl?.Taxonomy?.getIconVariants?.() ?? [];
}

/** Reads the taxonomy `symbolPrefix` through the runtime seam. */
function _getSymbolPrefix(): string {
    const icons = getGeoLeaf()?.Taxonomy?.getIcons?.() as { symbolPrefix?: unknown } | null;
    return typeof icons?.symbolPrefix === "string" ? icons.symbolPrefix : "";
}

/**
 * Registers all SVG `<symbol>` elements from the injected profile sprite as
 * images in the MapLibre map instance.
 *
 * Each symbol's `id` attribute becomes the image name used in the symbol layer's
 * `"icon-image"` expression (`["get", "symbolId"]`).
 *
 * @param map - Native `maplibregl.Map` instance.
 */
/**
 * Returns `true` when the profile sprite `<svg>` is present in the DOM.
 *
 * Lets callers (e.g. the adapter's post-style-change hook) skip
 * {@link registerSpriteIcons} — and its "sprite not in DOM" warning — for
 * profiles that ship no sprite, without duplicating the selector.
 */
export function hasProfileSprite(): boolean {
    return (
        typeof document !== "undefined" &&
        document.querySelector('svg[data-geoleaf-sprite="profile"]') !== null
    );
}

/**
 * Renders the profile's POI icons and registers them with the map as images.
 *
 * ⚠️ Awaits the style for the same reason as {@link createClusteredSource} — `addImage`
 * before the style has loaded is dropped. Individual icons that fail to render are logged and
 * skipped rather than aborting the batch: one broken icon must not cost every marker.
 *
 * @param mapArg - The native MapLibre map, accepted permissively because cross-module callers
 *   pass a structural view of it.
 */
export async function registerSpriteIcons(mapArg: unknown): Promise<void> {
    // Cross-module callers (poi/core, vector-tiles) pass a permissive structural
    // map view; the runtime value is always the native MapLibre map.
    const map = mapArg as MaplibreMap;
    if (!map.isStyleLoaded()) {
        await new Promise<void>((resolve) => {
            // `once(type, listener)` returns the map, not a promise — MapLibre unions
            // both in a single signature. ⚠️ `resolve` is NOT passed directly: it is a
            // continuation, not an event listener. Its parameter is `void | PromiseLike<void>`,
            // which MapLibre's `Listener` argument is not assignable to since 6.3.0 typed it
            // (TS2769). Wrapping states the truth — resume when the event fires, ignore it.
            void map.once("styledata", () => resolve());
        });
    }

    const spriteEl = document.querySelector<Element>('svg[data-geoleaf-sprite="profile"]');
    if (!spriteEl) {
        if (Log)
            Log.warn(
                "[POI] registerSpriteIcons: sprite not in DOM — icons will not be registered."
            );
        return;
    }

    const symbols = Array.from(spriteEl.querySelectorAll("symbol[id]"));
    if (symbols.length === 0) {
        if (Log) Log.warn("[POI] registerSpriteIcons: no symbols found in sprite.");
        return;
    }

    const canvasSize = ICON_SIZE_PX * ICON_PIXEL_RATIO;

    // Pass 1 — every sprite symbol, untinted. Ids are byte-identical to what they
    // have always been, so profiles that declare no icon colour see no change.
    const registered = symbols.filter((s) => _processSymbol(map, s, canvasSize, spriteEl)).length;

    // Pass 2 — the tinted variants the taxonomy config actually references.
    //
    // This MUST live inside registerSpriteIcons, not at a call site. `setStyle()`
    // (a basemap swap) empties MapLibre's image store, and the adapter recovers by
    // calling this function again — anything registered elsewhere would be gone for
    // good, and every tinted icon would vanish the first time the user changes the
    // background map.
    const variants = _getTaxonomyIconVariants();
    const prefix = _getSymbolPrefix();
    const tinted = variants.filter((v) =>
        _processVariant(map, v, canvasSize, spriteEl, prefix)
    ).length;

    if (Log) Log.info(`[POI] ${registered} icon(s) + ${tinted} tinted variant(s) registered.`);
}

/**
 * Ensures the profile sprite is injected and its MapLibre images registered for a
 * layer that carries `symbolId` features. The sprite is DOM-injected lazily and its
 * images are otherwise only (re)registered on a basemap style swap — so a POI layer
 * loaded without a basemap change (e.g. a data-theme switch) would render no icons.
 * Idempotent: the sprite loader no-ops once injected, `registerSpriteIcons` skips
 * existing images, and `map.addImage()` triggers a repaint so the symbol layer picks
 * them up. No-op when the data carries no `symbolId` features. Extracted from the
 * adapter's `addGeoJSONLayer` (socle B.1) to keep it under the 700-line budget.
 */
export function ensureLayerSpriteIcons(map: MaplibreMap | null, data: unknown): void {
    const feats = (data as { features?: unknown[] } | null)?.features;
    const hasIconFeatures =
        Array.isArray(feats) &&
        feats.some(
            (f) =>
                (f as { properties?: { symbolId?: unknown } } | null)?.properties?.symbolId != null
        );
    if (!hasIconFeatures) return;
    void ensureProfileSpriteInjectedSync()
        .then(() => {
            if (map && hasProfileSprite()) return registerSpriteIcons(map);
            return undefined;
        })
        .catch((err) => Log.warn("[POI] sprite registration failed:", err));
}
