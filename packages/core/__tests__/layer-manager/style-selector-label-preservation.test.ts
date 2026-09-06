/**
 * Regression: switching a layer's style must not strip `currentStyle.label`.
 *
 * `setLayerStyle` overwrites the registered entry's `currentStyle` with the FLAT
 * paint object handed to the adapter — that object carries no `label`. The style
 * selector must restore the full style document afterwards, the way the theme
 * applier's `_onStyleLoaded` already does, or `Labels.initializeLayerLabels()`
 * and the 🏷️ button both read a style with no label config.
 */

import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("../../src/kernel/config/config-primitives.js", () => ({
    Config: { get: vi.fn() },
}));

/** The registered entry, i.e. what `GeoJSONShared.state.layers.get(id)` returns. */
/** A profile style file: `label` is a SIBLING of `style`, never its child. */
interface StyleDoc {
    id: string;
    label: { enabled: boolean; visibleByDefault: boolean; field: string };
    style: { shape: string; radius: number; fillColor: string };
}

/** The registered layer entry, i.e. what `getLayerById()` returns. */
interface Entry {
    id: string;
    config: Record<string, unknown>;
    currentStyle: StyleDoc | Record<string, unknown> | null;
    _visibility: { current: boolean };
}

const registered: Entry = {
    id: "candelabres",
    config: {
        id: "candelabres",
        _profileId: "reunion-eclairage",
        _layerDirectory: "layers/candelabres",
        styles: {
            directory: "styles",
            default: "altitude.json",
            available: [
                { id: "altitude", file: "altitude.json" },
                { id: "defaut", file: "defaut.json" },
            ],
        },
    },
    currentStyle: null,
    _visibility: { current: true },
};

vi.mock("../../src/kernel/geojson/core.js", () => ({
    GeoJSONCore: {
        // Faithful to `layers/store.ts`: a PROJECTION, not the registered entry.
        getLayerData: vi.fn(() => ({
            geojson: null,
            features: [],
            geometryType: "point",
            config: registered.config,
            layer: null,
        })),
        getLayerById: vi.fn(() => registered),
        // Faithful to `layers/style.ts:68`.
        setLayerStyle: vi.fn((_layerId: string, styleConfig: unknown) => {
            registered.currentStyle = styleConfig as Record<string, unknown>;
            return true;
        }),
    },
}));

const styleDoc = (id: string): StyleDoc => ({
    id,
    label: { enabled: true, visibleByDefault: true, field: "id" },
    style: { shape: "circle", radius: 7, fillColor: "#facc15" },
});

vi.mock("../../src/utils/loaders/style-loader.js", () => ({
    StyleLoader: {
        loadAndValidateStyle: vi.fn(async (_p: string, _l: string, styleId: string) => ({
            styleData: styleDoc(styleId),
            metadata: { styleId },
        })),
    },
}));
vi.mock("../../src/capabilities/legend/legend-seam.js", () => ({
    LegendContract: { isAvailable: vi.fn(() => false) },
}));

/** Reads the label switch off the entry the way `labels.ts` and the toggle do. */
function labelEnabled(): boolean | undefined {
    const style = registered.currentStyle as { label?: { enabled?: boolean } } | null;
    return style?.label?.enabled;
}

import { StyleSelector } from "../../src/kernel/layer-manager/style-selector.js";
import { GeoJSONCore } from "../../src/kernel/geojson/core.js";

describe("style-selector — the label config survives a style change", () => {
    beforeEach(() => {
        registered.currentStyle = styleDoc("altitude");
    });

    it("leaves `currentStyle.label.enabled` true on the REGISTERED entry", async () => {
        await StyleSelector.applyStyle("candelabres", "defaut");
        expect(GeoJSONCore.setLayerStyle).toHaveBeenCalled();
        expect(labelEnabled()).toBe(true);
    });

    it("keeps the paint flattened for the adapter while restoring the document", async () => {
        await StyleSelector.applyStyle("candelabres", "defaut");
        const setLayerStyle = GeoJSONCore.setLayerStyle as unknown as Mock;
        const paint = setLayerStyle.mock.calls.at(-1)?.[1] as Record<string, unknown>;
        expect(paint.fillColor).toBe("#facc15");
        expect(paint.label).toBeUndefined();
        expect(labelEnabled()).toBe(true);
    });

    it("switching back to the first style restores the 🏷️ precondition", async () => {
        await StyleSelector.applyStyle("candelabres", "defaut");
        await StyleSelector.applyStyle("candelabres", "altitude");
        expect(labelEnabled()).toBe(true);
    });
});
