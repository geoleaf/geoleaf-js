/**
 * A style `label` that omits `visibleByDefault` lets the CALLER decide (style schema, LB-05):
 * a caller asking for its labels — `enableLabels(id, cfg, true)`, as a plugin does for its step
 * numbers — gets them shown; the loader's own path (`initializeLayerLabels`) keeps them hidden
 * until the user toggles them, as before.
 *
 * 🛑 The style loader wrote `visibleByDefault: false` into every enabled `label` that omitted it,
 * with a console warning on each load. The labels module then read a DECLARED `false`, which wins
 * over the caller — so the caller's request was silently ignored, contradicting the schema.
 *
 * The chain is exercised end to end: the real style loader produces the style document, which the
 * layer then wears as its `currentStyle`.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const logMock = vi.hoisted(() => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
}));
const layers = vi.hoisted(() => new Map<string, Record<string, unknown>>());
const createSymbolLayer = vi.hoisted(() => vi.fn());

vi.mock("../../../src/utils/log/index.js", () => ({ Log: logMock }));
vi.mock("../../../src/kernel/config/config-primitives.js", () => ({ Config: {} }));
vi.mock("../../../src/utils/validators/style-validator.js", () => ({
    StyleValidator: {
        validateStyle: vi.fn(() => ({ valid: true, errors: [], warnings: [] })),
        formatValidationErrors: vi.fn(() => ""),
    },
}));
vi.mock("../../../src/capabilities/labels/label-renderer.ts", () => ({
    LabelRenderer: {
        createSymbolLayerForMapLibre: (...args: unknown[]) => createSymbolLayer(...args),
    },
}));
vi.mock("../../../src/utils/general/scale-utils.js", () => ({
    isScaleInRange: vi.fn(() => true),
    calculateMapScale: vi.fn(() => 1000),
}));
vi.mock("../../../src/api/geoleaf.core.js", () => ({ Core: { getMap: vi.fn(() => null) } }));
vi.mock("../../../src/kernel/geojson/core.js", () => ({
    GeoJSONCore: { getLayerById: (id: string) => layers.get(id) ?? null },
}));

import { Labels } from "../../../src/capabilities/labels/labels.js";
import { StyleLoader } from "../../../src/utils/loaders/style-loader.js";

const FEATURES = [{ type: "Feature", properties: { step: 1 }, geometry: null }];

/** Loads a style document through the real style loader, served by a stubbed fetch. */
async function loadStyle(styleData: Record<string, unknown>): Promise<Record<string, unknown>> {
    StyleLoader.clearStyleCache();
    globalThis.fetch = vi.fn(() =>
        Promise.resolve({ ok: true, json: () => Promise.resolve(styleData) })
    ) as unknown as typeof fetch;
    const result = await StyleLoader.loadAndValidateStyle(
        "p",
        "route",
        "defaut",
        "defaut.json",
        "layers/route"
    );
    return (result as { styleData: Record<string, unknown> }).styleData;
}

async function routeLayerWithLoadedStyle(): Promise<void> {
    const currentStyle = await loadStyle({ label: { enabled: true, field: "step" } });
    layers.set("route", {
        currentStyle,
        config: { id: "route" },
        _visibility: { current: true },
        features: FEATURES,
    });
}

/** `initializeLayerLabels` does not await `enableLabels`: let its promise chain settle. */
async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) await Promise.resolve();
}

beforeEach(() => {
    vi.clearAllMocks();
    Labels.destroy();
    layers.clear();
    (globalThis as Record<string, unknown>).GeoLeaf = {
        Config: { get: vi.fn(() => "profiles") },
    };
});

describe("style `label` without `visibleByDefault` — the caller decides", () => {
    it("the loader leaves the key absent, without a warning", async () => {
        const styleData = await loadStyle({ label: { enabled: true, field: "step" } });
        expect((styleData.label as Record<string, unknown>).visibleByDefault).toBeUndefined();
        expect(logMock.warn).not.toHaveBeenCalled();
    });

    it("a caller asking for its labels gets them shown", async () => {
        await routeLayerWithLoadedStyle();
        await Labels.enableLabels("route", { enabled: true, labelId: "step" }, true);

        expect(Labels.areLabelsEnabled("route")).toBe(true);
        expect(createSymbolLayer).toHaveBeenCalledTimes(1);
    });

    it("the loader's own path keeps them hidden until the user toggles them", async () => {
        await routeLayerWithLoadedStyle();
        Labels.initializeLayerLabels("route");
        await settle();

        expect(Labels.hasLabelConfig("route")).toBe(true);
        expect(Labels.areLabelsEnabled("route")).toBe(false);
        expect(createSymbolLayer).not.toHaveBeenCalled();

        expect(Labels.toggleLabels("route")).toBe(true);
        await settle();
        expect(createSymbolLayer).toHaveBeenCalledTimes(1);
    });

    it("a declared `visibleByDefault: false` still wins over the caller", async () => {
        const currentStyle = await loadStyle({
            label: { enabled: true, field: "step", visibleByDefault: false },
        });
        layers.set("route", {
            currentStyle,
            config: { id: "route" },
            _visibility: { current: true },
            features: FEATURES,
        });
        await Labels.enableLabels("route", { enabled: true, labelId: "step" }, true);

        expect(Labels.areLabelsEnabled("route")).toBe(false);
        expect(createSymbolLayer).not.toHaveBeenCalled();
    });
});
