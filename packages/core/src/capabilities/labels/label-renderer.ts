/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Label Renderer module for GeoLeaf.
 * Builds the native MapLibre symbol layer that renders feature labels.
 * @private GeoLeaf._LabelRenderer
 */

import { Log } from "../../utils/log/index.js";
import { Core } from "../../api/geoleaf.core.js";
import type {
    LabelConfigLike,
    LabelsMapHandle,
    LabelsNativeMap,
    LabelStyleLike,
    RemovableTooltip,
} from "./types.js";

/**
 * Internal surface of the `_LabelRenderer` singleton, used to type the `this`
 * receiver of its methods (avoids `any` self-casts).
 */
interface LabelRendererApi {
    createSymbolLayerForMapLibre(
        layerId: string,
        labelConfig: LabelConfigLike,
        style: LabelStyleLike,
        tooltipsMap: Map<string, RemovableTooltip>
    ): void;
}

/**
 * Reads the first usable `text-font` array from the map's loaded style.
 * This avoids 404s caused by CSS font names (e.g. "Lucida Sans") not existing
 * as PBF glyphs on the tile server, or by MapLibre's built-in spec default
 * ("Open Sans Regular, Arial Unicode MS Regular") which OpenFreeMap doesn't serve.
 */
function _resolveMapFontStack(nativeMap: LabelsNativeMap): string[] {
    try {
        const mapStyle = nativeMap.getStyle?.();
        if (mapStyle?.layers) {
            for (const layer of mapStyle.layers) {
                if (layer.type !== "symbol") continue;
                const fonts = layer.layout?.["text-font"];
                // Accept a plain string array (not a MapLibre expression)
                if (Array.isArray(fonts) && fonts.length > 0 && typeof fonts[0] === "string") {
                    return fonts as string[];
                }
            }
        }
    } catch (_e) {
        // Ignore — fall through to safe default
    }
    // Safe fallback: Noto Sans is served by most self-hosted and cloud tile providers
    return ["Noto Sans Regular"];
}

const _LabelRenderer: LabelRendererApi = {
    /**
     * Creates a MapLibre native symbol layer for labels, on top of the existing
     * GeoJSON source. Cleanup is handled by storing a removal function in `tooltipsMap`.
     */
    createSymbolLayerForMapLibre(
        layerId: string,
        labelConfig: LabelConfigLike,
        style: LabelStyleLike,
        tooltipsMap: Map<string, RemovableTooltip>
    ): void {
        if (!labelConfig.labelId) {
            if (Log) Log.warn("[LabelRenderer] No labelId for MapLibre symbol layer", layerId);
            return;
        }
        const mapAdapter: LabelsMapHandle | null =
            Core && Core.getMap ? (Core.getMap() as LabelsMapHandle | null) : null;
        if (!mapAdapter || typeof mapAdapter.getNativeMap !== "function") {
            if (Log) Log.warn("[LabelRenderer] MapLibre adapter unavailable for labels", layerId);
            return;
        }
        const nativeMap = mapAdapter.getNativeMap();
        const registry = mapAdapter.getLayerRegistry?.();
        const sourceId: string = registry?.getSourceId?.(layerId) ?? `gl-src-${layerId}`;
        if (!nativeMap.getSource(sourceId)) {
            if (Log) Log.warn("[LabelRenderer] MapLibre source not found:", sourceId);
            return;
        }
        const labelLayerId = `gl-${layerId}-label-text`;
        if (nativeMap.getLayer(labelLayerId)) {
            nativeMap.removeLayer(labelLayerId);
        }
        // Resolve the font stack from the map's loaded style to avoid 404s.
        // CSS font names (e.g. "Lucida Sans") are not PBF glyphs — use whatever the
        // base style actually serves. Fall back to common OpenFreeMap/MapTiler names.
        const textFont = _resolveMapFontStack(nativeMap);
        nativeMap.addLayer({
            id: labelLayerId,
            type: "symbol",
            source: sourceId,
            layout: _buildLabelSymbolLayout(labelConfig, style, textFont),
            paint: _buildLabelSymbolPaint(style),
        });
        // Store a removal function so _clearTooltips() can remove the symbol layer
        tooltipsMap.set(labelLayerId, {
            remove: () => {
                if (nativeMap.getLayer(labelLayerId)) nativeMap.removeLayer(labelLayerId);
            },
        });
        if (Log)
            Log.debug(
                `[LabelRenderer] MapLibre symbol layer created for ${layerId} (field: ${labelConfig.labelId})`
            );
    },
};

/**
 * Points → CSS pixels. Profiles author label sizes in points (`font.sizePt`);
 * MapLibre's `text-size` is in pixels, and CSS defines one inch as 96 px against
 * typography's 72 pt.
 *
 * This was written `1.33` in place. The exact ratio is kept instead: the two
 * only diverge from `sizePt` 53 upwards (53, 56, 59, 62, 65, 68, 71 — one pixel
 * each), i.e. past a ~71 px label, so no realistic size changes.
 */
const PT_TO_PX = 96 / 72;

/** `text-size` used when a profile authors no point size. */
const DEFAULT_LABEL_SIZE_PX = 12;

/** `label.offset.distancePx` used when a placement is set without a distance. */
const DEFAULT_LABEL_OFFSET_PX = 12;

/**
 * Public `label.offset.placement` → MapLibre `text-anchor`.
 *
 * ⚠️ INVERTED ON PURPOSE, and it is not a typo. `text-anchor` names the edge of the TEXT
 * pinned to the anchor point, so a label sitting ABOVE its feature anchors by its `bottom`.
 * The public key names where the LABEL goes; this table is the only place the two
 * vocabularies meet. Verified branch by branch against `evaluateVariableOffset` in
 * maplibre-gl's own `variable_text_anchor` module, whose `fromRadialOffset`
 * reads `case "left": x = radialOffset` — anchor `left`, text to the RIGHT.
 */
const _PLACEMENT_TO_ANCHOR: Readonly<Record<string, string>> = {
    top: "bottom",
    bottom: "top",
    left: "right",
    right: "left",
    "top-left": "bottom-right",
    "top-right": "bottom-left",
    "bottom-left": "top-right",
    "bottom-right": "top-left",
};

/**
 * Builds the `text-anchor` / `text-radial-offset` pair for `label.offset`, or `null` to
 * leave the label centred on its feature.
 *
 * `text-radial-offset` is paired with a FIXED anchor deliberately, and it works outside the
 * variable-anchor path: `symbol_layout` reads it whenever it is non-zero and then ignores
 * `text-offset` entirely. Three things come with it that a raw `text-offset` does not give —
 * the distance is measured to the EDGE of the text box (so `distancePx` is the gap an author
 * can reason about), it stays euclidean on the diagonals, and the engine applies its own
 * baseline correction instead of leaving it to the caller.
 *
 * 🛑 Returning `null` rather than an explicit centred pair is what keeps the emitted layout
 * IDENTICAL to the pre-offset one for every profile that sets no placement. And the trigger
 * is `distancePx`, never `style.offset` itself: the inline `enableLabels()` path always
 * materialises `{ distancePx: 0 }`, so testing for the object would offset every layer
 * coming through it.
 *
 * @param style - Resolved label style; `offset` may be absent, partial or unrecognised.
 * @param textSize - The layer's `text-size` in pixels, the unit `distancePx` converts against.
 * @returns The two layout properties, or `null` to emit none.
 */
function _buildLabelOffsetLayout(
    style: LabelStyleLike,
    textSize: number
): Record<string, unknown> | null {
    const placement = style.offset?.placement;
    if (!placement || placement === "center") return null;
    // Own-property lookup: a bare index would answer "constructor" or "toString" through the
    // prototype chain and emit that as a text-anchor. Testing the RESOLVED value also narrows
    // it away from `undefined`, which `noUncheckedIndexedAccess` would otherwise let through.
    const anchor = Object.prototype.hasOwnProperty.call(_PLACEMENT_TO_ANCHOR, placement)
        ? _PLACEMENT_TO_ANCHOR[placement]
        : undefined;
    if (!anchor) return null;
    const distancePx = style.offset?.distancePx ?? DEFAULT_LABEL_OFFSET_PX;
    // Guard the division. `sizePt` reaches the inline path unvalidated by any schema, where a
    // non-numeric or sub-pixel value rounds `textSize` to 0 or NaN.
    if (typeof distancePx !== "number" || !Number.isFinite(distancePx) || distancePx <= 0)
        return null;
    if (!Number.isFinite(textSize) || textSize <= 0) return null;
    // `text-radial-offset` is expressed in ems of `text-size`; profiles author pixels.
    return { "text-anchor": anchor, "text-radial-offset": distancePx / textSize };
}

/** Builds the MapLibre symbol `layout` for a label text layer. */
function _buildLabelSymbolLayout(
    labelConfig: LabelConfigLike,
    style: LabelStyleLike,
    textFont: unknown
): Record<string, unknown> {
    const textSize = style.font?.sizePt
        ? Math.round(style.font.sizePt * PT_TO_PX)
        : DEFAULT_LABEL_SIZE_PX;
    return {
        "text-field": ["get", labelConfig.labelId],
        "text-size": textSize,
        "text-allow-overlap": false,
        "text-ignore-placement": false,
        "text-font": textFont,
        // Spreading null is a no-op: a centred label emits exactly the five keys above.
        ..._buildLabelOffsetLayout(style, textSize),
    };
}

/** Builds the MapLibre symbol `paint` (text colour/opacity + optional halo) for a label layer. */
function _buildLabelSymbolPaint(style: LabelStyleLike): Record<string, unknown> {
    const paint: Record<string, unknown> = {
        "text-color": style.color ?? "#000000",
        "text-opacity": style.opacity ?? 1,
    };
    if (style.buffer?.enabled) {
        paint["text-halo-color"] = style.buffer.color ?? "#ffffff";
        paint["text-halo-width"] = style.buffer.sizePx ?? 2;
        paint["text-halo-blur"] = 0.5;
    }
    return paint;
}

export { _LabelRenderer as LabelRenderer };
