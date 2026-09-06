/**
 * Regression, ORDER: the style selector must restore the style DOCUMENT on the
 * registered entry BEFORE it calls into Labels.
 *
 * `style-selector-label-preservation.test.ts` guards the FINAL value of
 * `currentStyle` and cannot see this: move the restore below
 * `initializeLayerLabels()` and the production bug is fully reinstated — Labels
 * and the 🏷️ toggle both read a `currentStyle` that is still the flat paint —
 * while every end-state assertion stays green. Measured: that mutation keeps the
 * preservation guard at 3/3 passing.
 *
 * These tests therefore observe the field AT THE MOMENT each consumer reads it.
 */
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

/** A profile style file: `label` is a SIBLING of `style`, never its child. */
interface StyleDoc {
    id: string;
    label: { enabled: boolean; visibleByDefault: boolean; field: string };
    labelScale: { minScale: number | null; maxScale: number | null };
    style: { shape: string; radius: number; fillColor: string };
}

/** What one Labels consumer saw on the entry at the moment it ran. */
type Sighting = [string, boolean | undefined];

/**
 * Built inside `vi.hoisted` so the mock factories below can close over it.
 *
 * `entry` starts populated rather than `null`: the repo forbids non-null assertions
 * (NNA gate), and a nullable store would spread `?.` through every mock for a value
 * that is never absent in this suite.
 */
const store = vi.hoisted(() => {
    const doc = (id: string) => ({
        id,
        label: { enabled: true, visibleByDefault: true, field: "ville" },
        labelScale: { minScale: null, maxScale: null },
        style: { shape: "circle", radius: 7, fillColor: "#facc15" },
    });
    const entry = {
        id: "villes_principales",
        config: {
            id: "villes_principales",
            _profileId: "tourism",
            _layerDirectory: "layers/villes_principales",
            styles: {
                directory: "styles",
                available: [
                    { id: "defaut", file: "defaut.json" },
                    { id: "population", file: "population.json" },
                ],
            },
        },
        currentStyle: doc("defaut") as StyleDoc | Record<string, unknown>,
        _visibility: { current: true },
    };
    return { doc, entry, seen: [] as Sighting[] };
});

/** Reads the label switch off the entry the way `labels.ts` and the toggle do. */
function labelEnabled(): boolean | undefined {
    const style = store.entry.currentStyle as { label?: { enabled?: boolean } };
    return style?.label?.enabled;
}

vi.mock("../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../src/kernel/config/config-primitives.js", () => ({
    Config: { get: vi.fn(() => ({ profilesBasePath: "profiles" })) },
}));

vi.mock("../../src/kernel/geojson/core.js", () => ({
    GeoJSONCore: {
        // Faithful to `layers/store.ts` `getLayerData`: a five-field PROJECTION rebuilt on
        // every call, NOT the registered entry — it carries no `currentStyle`, so anything
        // written to it is discarded.
        getLayerData: vi.fn(() => ({
            geojson: null,
            features: [],
            geometryType: "point",
            config: store.entry.config,
            layer: null,
        })),
        // Faithful to `layers/store.ts` `getLayerById`: the live entry.
        getLayerById: vi.fn(() => store.entry),
        // Faithful to `layers/style.ts`: the flat paint REPLACES `currentStyle`.
        // A bare `vi.fn()` here would hide the defect entirely.
        setLayerStyle: vi.fn((_layerId: string, styleConfig: unknown) => {
            store.entry.currentStyle = styleConfig as Record<string, unknown>;
            return true;
        }),
    },
}));

vi.mock("../../src/utils/general/geoleaf-global.js", () => ({
    getGeoLeaf: () => ({
        Labels: {
            initializeLayerLabels: vi.fn(() => {
                store.seen.push(["initializeLayerLabels", labelEnabled()]);
            }),
        },
        _LabelButtonManager: {
            syncImmediate: vi.fn(() => {
                store.seen.push(["syncImmediate", labelEnabled()]);
            }),
        },
    }),
}));

vi.mock("../../src/utils/loaders/style-loader.js", () => ({
    StyleLoader: {
        loadAndValidateStyle: vi.fn(async (_p: string, _l: string, styleId: string) => ({
            styleData: store.doc(styleId),
            metadata: { styleId },
        })),
    },
}));
vi.mock("../../src/capabilities/legend/legend-seam.js", () => ({
    LegendContract: { isAvailable: vi.fn(() => false), loadLayerLegend: vi.fn() },
}));

import { StyleSelector } from "../../src/kernel/layer-manager/style-selector.js";
import { GeoJSONCore } from "../../src/kernel/geojson/core.js";

describe("style-selector — the document is restored BEFORE Labels reads it", () => {
    beforeEach(() => {
        store.seen = [];
        store.entry.currentStyle = store.doc("defaut");
    });

    it("hands initializeLayerLabels an entry that still carries the label block", async () => {
        await StyleSelector.applyStyle("villes_principales", "population");
        expect(store.seen).toEqual([
            ["initializeLayerLabels", true],
            ["syncImmediate", true],
        ]);
    });

    it("holds on the return trip — the 🏷️ precondition is true both ways", async () => {
        await StyleSelector.applyStyle("villes_principales", "population");
        await StyleSelector.applyStyle("villes_principales", "defaut");
        expect(store.seen.map(([, enabled]) => enabled)).toEqual([true, true, true, true]);
    });

    it("still hands the adapter a FLAT paint, with no label leaking into it", async () => {
        await StyleSelector.applyStyle("villes_principales", "population");
        const setLayerStyle = GeoJSONCore.setLayerStyle as unknown as Mock;
        const paint = setLayerStyle.mock.calls.at(-1)?.[1] as Record<string, unknown>;
        expect(paint.fillColor).toBe("#facc15");
        expect(paint.label).toBeUndefined();
        expect(paint.labelScale).toBeUndefined();
    });
});
