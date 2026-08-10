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
