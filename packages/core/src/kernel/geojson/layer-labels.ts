/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Which label configuration a layer wears — ONE answer for every reader.
 *
 * A layer's labels are declared in one of two places:
 * - the `label` OBJECT of its current style file — the historical home, which keeps priority;
 * - the `labels` block of its definition — a profile's layer config, or a `Layers.create()`
 *   definition.
 *
 * 🛑 **The second place was half-wired.** The loader read `labels.enabled` as a TRIGGER —
 * it made `Labels.initializeLayerLabels()` run — and every reader after it looked at
 * `currentStyle.label` alone: the labels module, the layer manager's toggle, the re-show on
 * visibility. A layer whose default style file is missing keeps `currentStyle: null`, so its
 * declared labels never rendered and their toggle stayed disabled. Every reader now asks here.
 *
 * ⚠️ `currentStyle.label` is polymorphic in the style format: a display NAME (a string) or a label
 * CONFIGURATION (an object). Only the object configures labels; a name defers to the definition.
 */

/** A label configuration — the `label` object of a style file, or a layer's `labels` block. */
export interface LayerLabelConfig {
    enabled?: boolean;
    visibleByDefault?: boolean;
    [key: string]: unknown;
}

/** The two fields of a layer entry the resolution reads — structural, so every reader's type fits. */
export interface LabelSourceEntry {
    currentStyle?: { label?: unknown; [key: string]: unknown } | null;
    config?: { labels?: unknown; [key: string]: unknown } | null;
}

function _asConfigObject(value: unknown): LayerLabelConfig | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as LayerLabelConfig)
        : null;
}

/**
 * Resolves the label configuration a layer wears: its current style's `label` object when it has
 * one, else its definition's `labels` block, else `null`.
 *
 * The definition's block is read with a style file's semantics, down to the default the style
 * loader applies: an enabled block that does not say `visibleByDefault` is shown only once the user
 * asks for it (`visibleByDefault: false`). That default is applied to a COPY — the definition is
 * never written back.
 *
 * @param entry - A layer entry, as `GeoJSON.getLayerById(id)` returns it; `null` when unknown.
 * @returns The label configuration, or `null` when neither place declares one.
 */
export function resolveLayerLabelConfig(
    entry: LabelSourceEntry | null | undefined
): LayerLabelConfig | null {
    if (!entry) return null;
    const fromStyle = _asConfigObject(entry.currentStyle?.label);
    if (fromStyle) return fromStyle;
    const fromDefinition = _asConfigObject(entry.config?.labels);
    if (!fromDefinition) return null;
    if (fromDefinition.enabled === true && fromDefinition.visibleByDefault === undefined) {
        return { ...fromDefinition, visibleByDefault: false };
    }
    return fromDefinition;
}
