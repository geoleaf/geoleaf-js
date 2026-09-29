/**
 * The load-time field diagnostic — a declared name the data does not carry is SAID.
 *
 * The fixture has the shape of the defect it was written for: a taxonomy declaring
 * `subCategoryField: "subcategoryId"` over thirty features that carry `subCategoryId`. The
 * resolver read `undefined`, fell back to the category's icon, and nothing said so.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const warn = vi.hoisted(() => vi.fn());
const debug = vi.hoisted(() => vi.fn());
vi.mock("../../src/utils/general/di-accessors.js", () => ({
    getLog: () => ({ debug, info: vi.fn(), warn, error: vi.fn() }),
}));

const state = vi.hoisted(() => ({ layers: new Map() }));
vi.mock("../../src/kernel/geojson/shared.js", () => ({ GeoJSONShared: { state } }));

import {
    reconcileLayerFields,
    reconcileStyleFields,
} from "../../src/kernel/geojson/field-reconciliation.js";
import { provideDeclaredFields } from "../../src/kernel/shared/index.js";
import { runLifecycleTeardowns } from "../../src/kernel/shared/lifecycle.js";
import { taxonomyDeclaredFields } from "../../src/capabilities/taxonomy/declared-fields.js";
import type { TaxonomyConfig } from "../../src/capabilities/taxonomy/types.js";

const TAXONOMY: TaxonomyConfig = {
    enabled: true,
    layers: { candelabres: { use: "poi-cat" } },
    taxonomies: {
        "poi-cat": {
            categoryField: "categoryId",
            subCategoryField: "subcategoryId",
            categories: { eclairage: { label: "Éclairage public" } },
        },
    },
} as TaxonomyConfig;

let taxonomy: TaxonomyConfig = TAXONOMY;

const features = (count = 30) =>
    Array.from({ length: count }, (_, i) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [55.4, -21.1] },
        properties: { id: `C${i}`, categoryId: "eclairage", subCategoryId: "candelabres" },
    }));

const DEF = { id: "candelabres" };

beforeEach(() => {
    warn.mockClear();
    debug.mockClear();
    state.layers.clear();
    taxonomy = TAXONOMY;
    provideDeclaredFields("taxonomy", ({ layerId }) => taxonomyDeclaredFields(taxonomy, layerId));
    provideDeclaredFields("throws", null);
    runLifecycleTeardowns();
});

describe("reconcileLayerFields", () => {
    it("names the declared field no sampled feature carries, with its key, its count and a hint", () => {
        reconcileLayerFields("candelabres", DEF, null, features());

        expect(warn).toHaveBeenCalledTimes(1);
        const message = String(warn.mock.calls[0]![0]);
        expect(message).toContain('"candelabres"');
        expect(message).toContain("modules.taxonomy.taxonomies.poi-cat.subCategoryField");
        expect(message).toContain('"subcategoryId"');
        expect(message).toContain("30");
        expect(message).toContain('did you mean "subCategoryId"');
        // The category field IS carried: it must not be accused.
        expect(message).not.toContain('"categoryId"');
    });

    it("says it once per layer and field — a second load of the same layer is silent", () => {
        reconcileLayerFields("candelabres", DEF, null, features());
        reconcileLayerFields("candelabres", DEF, null, features());

        expect(warn).toHaveBeenCalledTimes(1);
    });

    it("says it again after an unmount — the lifecycle teardown re-arms it", () => {
        reconcileLayerFields("candelabres", DEF, null, features());
        runLifecycleTeardowns();
        reconcileLayerFields("candelabres", DEF, null, features());

        expect(warn).toHaveBeenCalledTimes(2);
    });

    it("stays silent on an empty layer — nothing was sampled, so nothing is missing", () => {
        reconcileLayerFields("candelabres", DEF, null, []);

        expect(warn).not.toHaveBeenCalled();
    });

    it("stays silent when the reader is disabled — nothing reads the field", () => {
        taxonomy = { ...TAXONOMY, enabled: false };
        reconcileLayerFields("candelabres", DEF, null, features());

        expect(warn).not.toHaveBeenCalled();
    });

    it("counts a property present with null as carried — sparse data is not a naming fault", () => {
        const sparse = features().map((f) => ({
            ...f,
            properties: { ...f.properties, subcategoryId: null },
        }));
        reconcileLayerFields("candelabres", DEF, null, sparse);

        expect(warn).not.toHaveBeenCalled();
    });

    it("keeps judging when one reader throws, and never throws into the load", () => {
        provideDeclaredFields("throws", () => {
            throw new Error("broken reader");
        });

        expect(() => reconcileLayerFields("candelabres", DEF, null, features())).not.toThrow();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]![0])).toContain('"subcategoryId"');
    });

    it("judges the style's rules under the renderer's rule — one leading `properties.` stripped", () => {
        const style = {
            id: "par_population",
            styleRules: [
                { when: { field: "properties.subCategoryId", operator: "==", value: "x" } },
                {
                    when: {
                        all: [
                            { field: "properties.population_2022", operator: ">", value: 1 },
                            { field: "properties.properties.id", operator: "==", value: 1 },
                        ],
                    },
                },
            ],
        };
        reconcileLayerFields("candelabres", DEF, style, features());

        const message = String(warn.mock.calls[0]![0]);
        expect(message).toContain("style[par_population].styleRules[1].when.all[0].field");
        expect(message).toContain('"properties.population_2022"');
        // `properties.properties.id` reads the literal key `properties.id`, which no feature has.
        expect(message).toContain('"properties.properties.id"');
        expect(message).not.toContain("styleRules[0]");
    });
});

describe("reconcileStyleFields", () => {
    it("judges a switched style against the features the layer already holds", () => {
        state.layers.set("candelabres", { config: DEF, features: features() });
        reconcileStyleFields("candelabres", {
            id: "defaut",
            styleRules: [{ when: { field: "statut", operator: "==", value: "HS" } }],
        });

        const messages = warn.mock.calls.map((c) => String(c[0])).join("\n");
        expect(messages).toContain("style[defaut].styleRules[0].when.field");
        expect(messages).toContain('"statut"');
    });

    it("does nothing for a layer the map does not hold", () => {
        expect(() => reconcileStyleFields("absent", { id: "x" })).not.toThrow();
        expect(warn).not.toHaveBeenCalled();
    });
});
