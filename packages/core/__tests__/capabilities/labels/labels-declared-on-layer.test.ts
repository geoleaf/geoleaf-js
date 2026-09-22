/**
 * Labels declared on the LAYER — its definition's `labels` block — render when the layer has no
 * style label, which is the case whenever its default style file is missing.
 *
 * 🛑 The block was half-wired: `labels.enabled` made the loader call
 * `Labels.initializeLayerLabels()`, and every reader after it tested `currentStyle.label` alone —
 * `null` once the style file 404s. The labels never rendered, and their toggle stayed disabled.
 * One resolver now answers every reader: the style's `label` OBJECT when it has one (it keeps
 * priority), else the definition's block.
 *
 * ✅ Seen turning red by mutation on 22/09/2026: `resolveLayerLabelConfig` reduced to the style's
 * label alone fails the definition cases — render, toggle and button — and the resolver cases that
 * read the block; the priority and `null` cases hold.
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
import { LabelButtonManager } from "../../../src/capabilities/labels/label-button-manager.js";
import { resolveLayerLabelConfig } from "../../../src/kernel/geojson/layer-labels.js";

const FEATURES = [{ type: "Feature", properties: { name: "A" }, geometry: null }];

/** A layer whose default style file was missing: `currentStyle` stayed `null`. */
function layerWithoutStyle(labels: Record<string, unknown>): Record<string, unknown> {
    return {
        currentStyle: null,
        config: { id: "parcels", labels },
        _visibility: { current: true },
        features: FEATURES,
    };
}

/** `initializeLayerLabels` does not await `enableLabels`: let its promise chain settle. */
async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) await Promise.resolve();
}

beforeEach(() => {
    vi.clearAllMocks();
    Labels.destroy();
    layers.clear();
});

describe("resolveLayerLabelConfig — one answer for every reader", () => {
    it("the style's `label` object wins over the definition's block", () => {
        const styleLabel = { enabled: false };
        const entry = {
            currentStyle: { label: styleLabel },
            config: { labels: { enabled: true } },
        };
        expect(resolveLayerLabelConfig(entry)).toBe(styleLabel);
    });

    it("a style display NAME is not a configuration: the definition's block answers", () => {
        const entry = {
            currentStyle: { label: "Parcels" },
            config: { labels: { enabled: true, field: "name", visibleByDefault: true } },
        };
        expect(resolveLayerLabelConfig(entry)).toEqual({
            enabled: true,
            field: "name",
            visibleByDefault: true,
        });
    });

    it("without a style, the definition's block — `visibleByDefault` defaulted on a COPY", () => {
        const block = { enabled: true, field: "name" };
        const resolved = resolveLayerLabelConfig({ currentStyle: null, config: { labels: block } });
        expect(resolved).toEqual({ enabled: true, field: "name", visibleByDefault: false });
        expect(block).toEqual({ enabled: true, field: "name" });
    });

    it.each([
        ["no entry", null],
        ["neither place", { currentStyle: null, config: {} }],
        ["a non-object block", { currentStyle: null, config: { labels: true } }],
        ["an array block", { currentStyle: null, config: { labels: [] } }],
    ])("answers `null` for %s", (_label, entry) => {
        expect(resolveLayerLabelConfig(entry as never)).toBeNull();
    });
});

describe("Labels — a layer without style shows the labels its definition declares", () => {
    it("renders them, with the definition's field, when `visibleByDefault` is true", async () => {
        layers.set(
            "parcels",
            layerWithoutStyle({ enabled: true, field: "name", visibleByDefault: true })
        );
        Labels.initializeLayerLabels("parcels");
        await settle();

        expect(Labels.hasLabelConfig("parcels")).toBe(true);
        expect(Labels.areLabelsEnabled("parcels")).toBe(true);
        expect(createSymbolLayer).toHaveBeenCalledTimes(1);
        expect(createSymbolLayer).toHaveBeenCalledWith(
            "parcels",
            { labelId: "name" },
            expect.objectContaining({ enabled: true, field: "name" }),
            expect.any(Map)
        );
    });

    it("keeps them hidden until asked when `visibleByDefault` is absent — and the toggle works", async () => {
        layers.set("parcels", layerWithoutStyle({ enabled: true, field: "name" }));
        Labels.initializeLayerLabels("parcels");
        await settle();

        expect(Labels.hasLabelConfig("parcels")).toBe(true);
        expect(Labels.areLabelsEnabled("parcels")).toBe(false);
        expect(createSymbolLayer).not.toHaveBeenCalled();

        expect(Labels.toggleLabels("parcels")).toBe(true);
        await settle();
        expect(createSymbolLayer).toHaveBeenCalledTimes(1);
    });

    it("the layer manager's toggle is enabled for it", () => {
        layers.set("parcels", layerWithoutStyle({ enabled: true, field: "name" }));
        expect(LabelButtonManager._getState("parcels").labelEnabled).toBe(true);
    });

    it("a style that carries its own `label` still decides — here, no labels", async () => {
        layers.set("parcels", {
            ...layerWithoutStyle({ enabled: true, field: "name", visibleByDefault: true }),
            currentStyle: { label: { enabled: false } },
        });
        Labels.initializeLayerLabels("parcels");
        await settle();

        expect(Labels.hasLabelConfig("parcels")).toBe(false);
        expect(createSymbolLayer).not.toHaveBeenCalled();
        expect(LabelButtonManager._getState("parcels").labelEnabled).toBe(false);
    });
});
