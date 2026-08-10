/**
 * `capabilities/filter/apply` — le pipeline de filtrage VIVANT.
 *
 * Aucun test direct jusqu'ici : ses deux seuls consommateurs (`contract.test.js`,
 * `lifecycle.test.js`) le `vi.mock` intégralement. Le chemin natif dormant
 * (`taxonomy-options.ts` + `engine/native.ts`), lui, avait 10 tests — c'est ce déséquilibre que
 * S5/N-4 solde : le dormant part, le vivant se fait tenir.
 */
import { vi } from "vitest";

const filterFeatures = vi.hoisted(() => vi.fn());
const getFeatures = vi.hoisted(() => vi.fn(() => []));
vi.mock("../../../src/kernel/geojson/core.js", () => ({
    GeoJSONCore: { filterFeatures, getFeatures },
}));

const dispatchGeoLeafEvent = vi.hoisted(() => vi.fn());
vi.mock("../../../src/kernel/events/event-bus.js", () => ({ dispatchGeoLeafEvent }));

const readActiveFilter = vi.hoisted(() => vi.fn(() => []));
vi.mock("../../../src/capabilities/filter/panel/state.js", () => ({ readActiveFilter }));

import {
    applyActiveFilterToSources,
    applyFilterFromPanel,
    resolveOptionsWithData,
} from "../../../src/capabilities/filter/apply.js";

describe("capabilities/filter/apply — applyActiveFilterToSources", () => {
    beforeEach(() => {
        filterFeatures.mockClear();
        getFeatures.mockClear();
        dispatchGeoLeafEvent.mockClear();
        readActiveFilter.mockReset().mockReturnValue([]);
    });

    it("filtre les TROIS géométries — un filtre ne vise pas que les points", () => {
        applyActiveFilterToSources([]);
        expect(filterFeatures).toHaveBeenCalledTimes(3);
        const geometries = filterFeatures.mock.calls.map((c) => c[1].geometryType);
        expect(geometries).toEqual(["polygon", "line", "point"]);
    });

    it("passe un prédicat qui reçoit (feature, layerId) — le scope `layers` en dépend", () => {
        // `featurePasses` honore le scope par couche : sans le layerId, un champ scopé
        // s'appliquerait à toutes les couches.
        applyActiveFilterToSources([
            {
                descriptor: { id: "f1", kind: "boolean", field: "actif", layers: ["lyr-a"] },
                bool: true,
            },
        ]);
        const predicate = filterFeatures.mock.calls[0][0];
        const refuse = { type: "Feature", properties: { actif: false } };
        // Dans le scope : le champ contraint → la feature est rejetée.
        expect(predicate(refuse, "lyr-a")).toBe(false);
        // Hors scope : le champ ne s'applique pas → la feature passe malgré tout.
        expect(predicate(refuse, "lyr-b")).toBe(true);
    });

    it("le prédicat rejette une feature qui ne satisfait pas le champ actif", () => {
        applyActiveFilterToSources([
            { descriptor: { id: "f1", kind: "boolean", field: "actif" }, bool: true },
        ]);
        const predicate = filterFeatures.mock.calls[0][0];
        expect(predicate({ type: "Feature", properties: { actif: true } }, "lyr")).toBe(true);
        expect(predicate({ type: "Feature", properties: { actif: false } }, "lyr")).toBe(false);
    });

    it("ne fait rien si le noyau GeoJSON n'expose pas la couture", async () => {
        vi.resetModules();
        vi.doMock("../../../src/kernel/geojson/core.js", () => ({ GeoJSONCore: {} }));
        const mod = await import("../../../src/capabilities/filter/apply.ts");
        expect(() => mod.applyActiveFilterToSources([])).not.toThrow();
        vi.doUnmock("../../../src/kernel/geojson/core.js");
        vi.resetModules();
    });
});

describe("capabilities/filter/apply — applyFilterFromPanel", () => {
    beforeEach(() => {
        filterFeatures.mockClear();
        dispatchGeoLeafEvent.mockClear();
        readActiveFilter.mockReset().mockReturnValue([]);
    });

    it("lit le panneau, applique, puis notifie — dans cet ordre", () => {
        const config = { fields: [] };
        const panel = null;
        applyFilterFromPanel(panel, config);

        expect(readActiveFilter).toHaveBeenCalledWith(panel, config);
        expect(filterFeatures).toHaveBeenCalledTimes(3);
        expect(dispatchGeoLeafEvent).toHaveBeenCalledWith("geoleaf:filters:applied", {});
    });

    it("fait passer la sélection par expandActiveFilter — la moitié VIVANTE de taxonomy-options.ts", () => {
        // Cocher une catégorie doit filtrer dessus. (L'expansion parent → enfants exige la
        // capacité taxonomy montée ; sans elle, la sélection passe telle quelle — ce qui
        // suffit à prouver que le pipeline traverse bien `expandActiveFilter`.)
        readActiveFilter.mockReturnValue([
            {
                descriptor: { id: "cat", kind: "taxonomy", field: "categorie" },
                values: ["hebergement"],
            },
        ]);
        applyFilterFromPanel(null, {
            fields: [{ id: "cat", kind: "taxonomy", field: "categorie" }],
        });
        const predicate = filterFeatures.mock.calls[0][0];
        expect(predicate({ type: "Feature", properties: { categorie: "hebergement" } }, "l")).toBe(
            true
        );
        expect(predicate({ type: "Feature", properties: { categorie: "autre" } }, "l")).toBe(false);
    });
});

describe("capabilities/filter/apply — resolveOptionsWithData", () => {
    beforeEach(() => {
        getFeatures.mockReset().mockReturnValue([]);
    });

    it("dérive les options d'un champ tag `auto` depuis les features réelles", () => {
        getFeatures.mockReturnValue([
            { type: "Feature", properties: { tags: "plage" } },
            { type: "Feature", properties: { tags: "montagne" } },
            { type: "Feature", properties: { tags: "plage" } },
        ]);
        const options = resolveOptionsWithData({
            fields: [{ id: "t", kind: "tag", field: "tags", options: "auto" }],
        });
        expect(options.t.values.map((v) => v.value).sort()).toEqual(["montagne", "plage"]);
    });

    it("restreint la collecte aux couches visées par le champ", () => {
        resolveOptionsWithData({
            fields: [{ id: "t", kind: "tag", field: "tags", options: "auto", layers: ["lyr-a"] }],
        });
        expect(getFeatures).toHaveBeenCalledWith({ layerIds: ["lyr-a"] });
    });

    it("ne collecte rien pour un champ tag à options déclarées", () => {
        const options = resolveOptionsWithData({
            fields: [{ id: "t", kind: "tag", field: "tags", options: ["plage", "montagne"] }],
        });
        expect(getFeatures).not.toHaveBeenCalled();
        expect(options.t.values.map((v) => v.value)).toEqual(["plage", "montagne"]);
    });
});
