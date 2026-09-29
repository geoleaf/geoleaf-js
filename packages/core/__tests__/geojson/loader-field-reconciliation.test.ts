/**
 * The loader confronts every layer it converts with the fields its readers declare.
 *
 * Integration, not a spy: the real reconciliation runs behind the real loader, fed by a
 * reader in the declared-fields slot. What is locked is the wiring — the loader hands the
 * CONVERTED features and the style it resolved — and that a broken reader never costs the
 * layer its load.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    LoaderSingleLayer,
    setupSingleLayerDeps,
} from "../../src/kernel/geojson/loader/single-layer.js";
import { provideDeclaredFields } from "../../src/kernel/shared/index.js";
import type { DeclaredFieldFeature } from "../../src/kernel/shared/index.js";
import type { LoaderDependencies } from "../../src/kernel/geojson/loader/loader-types.js";
import { runLifecycleTeardowns } from "../../src/kernel/shared/lifecycle.js";

const warn = vi.hoisted(() => vi.fn());
vi.mock("../../src/utils/general/di-accessors.js", () => ({
    getLog: () => ({ debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() }),
}));

const state = vi.hoisted(() => ({
    layers: new Map<string, unknown>(),
    map: null as unknown,
    options: {},
    adapter: null as unknown,
}));
vi.mock("../../src/kernel/geojson/shared.js", () => ({ GeoJSONShared: { state } }));

const STYLE = {
    id: "par_statut",
    styleRules: [{ when: { field: "properties.etat", operator: "==", value: "HS" } }],
};

const data = () => ({
    type: "FeatureCollection",
    features: Array.from({ length: 3 }, (_, i) => ({
        type: "Feature",
        properties: { id: `f${i}`, statut: "OK", subCategoryId: "candelabres" },
        geometry: { type: "Point", coordinates: [0, 0] },
    })),
});

function deps(): LoaderDependencies {
    return {
        getLayerManager: () => ({ updateLayerVisibilityByZoom: vi.fn(), setLayerStyle: vi.fn() }),
        getLoader: () => undefined,
        getConfig: () => ({ getActiveProfileId: () => null, get: () => null }),
        getFeatureValidator: () => undefined,
        getLayerConfig: () => ({
            buildLayerOptions: () => ({}),
            inferGeometryType: () => "point",
            loadDefaultStyle: vi.fn().mockResolvedValue(STYLE),
        }),
        getVectorTiles: () => null,
        getCluster: () => undefined,
        getUtils: () => undefined,
        getNotifications: () => null,
        getCore: () => undefined,
        getPopupTooltip: () => undefined,
        getLabels: () => null,
        getWorkerManager: () => ({ isAvailable: () => false }),
        getDataConverter: () => ({ autoConvert: (x: unknown) => x }),
        getNormalizer: () => undefined,
        getAllLayerConfigs: () => undefined,
        setAllLayerConfigs: () => {},
    } as unknown as LoaderDependencies;
}

/** Loads one layer from a cached payload; its default style resolves to `STYLE`. */
async function load(id = "lyr") {
    setupSingleLayerDeps(deps());
    return LoaderSingleLayer._loadSingleLayer(
        id,
        "Ma couche",
        { _cachedData: data(), styles: { default: "par_statut.json" } } as never,
        {}
    );
}

const fieldWarnings = () => warn.mock.calls.filter((c) => String(c[0]).includes("declared field"));

describe("loader — declared fields confronted with the converted features", () => {
    beforeEach(() => {
        warn.mockClear();
        runLifecycleTeardowns();
        state.layers = new Map();
        state.map = { addLayer: vi.fn(), fitBounds: vi.fn(), getCenter: () => ({ lat: 4 }) };
        state.adapter = {
            addGeoJSONLayer: vi.fn(),
            setLayerZoomRange: vi.fn(),
            showLayer: vi.fn(),
            hideLayer: vi.fn(),
            getNativeMap: () => state.map,
        };
        (globalThis as Record<string, unknown>).GeoLeaf = {
            Config: { get: () => null, getActiveProfileId: () => null },
        };
        provideDeclaredFields("probe", ({ layerId }) => [
            {
                key: `probe.${layerId}.subCategoryField`,
                field: "subcategoryId",
                present: (f: DeclaredFieldFeature) =>
                    Object.prototype.hasOwnProperty.call(f.properties ?? {}, "subcategoryId"),
            },
        ]);
    });

    afterEach(() => {
        provideDeclaredFields("probe", null);
        (globalThis as Record<string, unknown>).GeoLeaf = undefined;
    });

    it("says, in one line, the reader's field and the style rule's field no feature carries", async () => {
        await load();
        expect(fieldWarnings()).toHaveLength(1);
        const message = String(fieldWarnings()[0]?.[0]);
        expect(message).toContain('"lyr"');
        expect(message).toContain('probe.lyr.subCategoryField "subcategoryId"');
        expect(message).toContain('did you mean "subCategoryId"');
        expect(message).toContain('style[par_statut].styleRules[0].when.field "properties.etat"');
        expect(message).toContain("3 loaded features");
    });

    it("still loads the layer when a reader throws", async () => {
        provideDeclaredFields("probe", () => {
            throw new Error("broken reader");
        });
        const result = await load();
        expect(result).toMatchObject({ id: "lyr", featureCount: 3 });
        // The kernel's own rule still speaks for the style.
        expect(String(fieldWarnings()[0]?.[0])).toContain('"properties.etat"');
    });
});
