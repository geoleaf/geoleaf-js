/**
 * `_applyFeatureVisibilityForLayer` — the LIVE filtering path.
 *
 * It had no direct test (its two consumers mock it wholesale), while the
 * DORMANT native path had ten. The asymmetry being corrected: the dormant
 * gets purged, so the live must first be held.
 *
 * What is at stake here: the choice between the GPU filter by id
 * (`setLayerFilter`, zero re-tiling) and resending the data (`setData`).
 * Picking the wrong branch breaks no test today — it breaks cluster
 * counters, or filters the wrong features when ids are not unique.
 */
const state = { layers: new Map(), adapter: null };
vi.mock("../../src/kernel/geojson/shared.ts", () => ({
    GeoJSONShared: {
        get state() {
            return state;
        },
    },
}));
import { _applyFeatureVisibilityForLayer } from "../../src/kernel/geojson/geojson-filter.js";

const feat = (id, props = {}) => ({
    type: "Feature",
    properties: { id, ...props },
    geometry: { type: "Point", coordinates: [0, 0] },
});
const newStats = () => ({ filtered: 0, total: 0, visible: 0 });
const passAll = () => true;
const passNone = () => false;

describe("geojson-filter — _applyFeatureVisibilityForLayer (chemin vivant)", () => {
    let setLayerFilter;
    let updateLayerData;

    beforeEach(() => {
        setLayerFilter = vi.fn();
        updateLayerData = vi.fn();
        state.adapter = { setLayerFilter, updateLayerData };
        state.layers = new Map();
    });

    describe("chemin GPU par id (ids uniques, non clusterisé)", () => {
        it("pousse une expression match sur les ids visibles", () => {
            const layer = { geometryType: "point", features: [feat("a"), feat("b"), feat("c")] };
            const stats = newStats();
            _applyFeatureVisibilityForLayer(layer, (f) => f.properties.id !== "b", "lyr", stats);

            expect(updateLayerData).not.toHaveBeenCalled();
            const [id, expr] = setLayerFilter.mock.calls[0];
            expect(id).toBe("lyr");
            expect(expr).toEqual(["match", ["to-string", ["get", "id"]], ["a", "c"], true, false]);
        });

        it("efface le filtre (null) quand tout est visible", () => {
            const layer = { geometryType: "point", features: [feat("a"), feat("b")] };
            _applyFeatureVisibilityForLayer(layer, passAll, "lyr", newStats());
            expect(setLayerFilter).toHaveBeenCalledWith("lyr", null);
        });

        it("utilise une sentinelle quand rien n'est visible — sinon le filtre s'effacerait", () => {
            const layer = { geometryType: "point", features: [feat("a"), feat("b")] };
            _applyFeatureVisibilityForLayer(layer, passNone, "lyr", newStats());
            const [, expr] = setLayerFilter.mock.calls[0];
            expect(expr[2]).toEqual(["__geoleaf_filter_none__"]);
        });
    });

    describe("garde cluster — une couche clusterisée doit être ré-alimentée", () => {
        // A GPU `setFilter` would leave the cluster counters frozen on the
        // BEFORE-filter total: the badge would announce 42 for 3 displayed features.
        const CLUSTER_SIGNALS = [
            ["clusterGroup présent", { clusterGroup: {} }],
            ["config.cluster", { config: { cluster: true } }],
            ["config.clustering", { config: { clustering: true } }],
            ["config.clusterRadius", { config: { clusterRadius: 50 } }],
            ["config.disableClusteringAtZoom", { config: { disableClusteringAtZoom: 14 } }],
        ];

        it.each(CLUSTER_SIGNALS)("%s → setData, jamais setLayerFilter", (_label, extra) => {
            const layer = { geometryType: "point", features: [feat("a"), feat("b")], ...extra };
            _applyFeatureVisibilityForLayer(
                layer,
                (f) => f.properties.id === "a",
                "lyr",
                newStats()
            );
            expect(setLayerFilter).not.toHaveBeenCalled();
            expect(updateLayerData).toHaveBeenCalledWith("lyr", {
                type: "FeatureCollection",
                features: [expect.objectContaining({ properties: { id: "a" } })],
            });
        });
    });

    describe("fallback id — le filtre GPU exige des ids uniques", () => {
        it("bascule sur setData quand une feature n'a pas d'id", () => {
            const sansId = { type: "Feature", properties: {}, geometry: null };
            const layer = { geometryType: "point", features: [feat("a"), sansId] };
            _applyFeatureVisibilityForLayer(layer, passAll, "lyr", newStats());
            expect(setLayerFilter).not.toHaveBeenCalled();
            expect(updateLayerData).toHaveBeenCalled();
        });

        it("bascule sur setData quand deux features partagent un id", () => {
            // Filtering by id would hide the duplicate along with the original.
            const layer = { geometryType: "point", features: [feat("a"), feat("a")] };
            _applyFeatureVisibilityForLayer(layer, passAll, "lyr", newStats());
            expect(setLayerFilter).not.toHaveBeenCalled();
            expect(updateLayerData).toHaveBeenCalled();
        });

        it("accepte un id numérique (l'unicité se juge sur la forme string)", () => {
            const layer = { geometryType: "point", features: [feat(1), feat(2)] };
            _applyFeatureVisibilityForLayer(layer, passAll, "lyr", newStats());
            expect(setLayerFilter).toHaveBeenCalled();
        });
    });

    describe("géométrie — une couche de lignes se filtre comme les autres", () => {
        // The filter used to skip every line layer unless it declared `search.enabled: true` — a
        // key the profile schema no longer accepts, so no profile could opt a line layer in.
        // The documented contract is geometry-agnostic: a field without `layers` filters them all.
        for (const geometryType of ["line", "linestring", "polyline", "multiline"]) {
            it(`une couche « ${geometryType} » est filtrée`, () => {
                const layer = { geometryType, features: [feat("a"), feat("b")] };
                const stats = newStats();
                _applyFeatureVisibilityForLayer(layer, passNone, "lyr", stats);

                expect(setLayerFilter).toHaveBeenCalledWith("lyr", [
                    "match",
                    ["to-string", ["get", "id"]],
                    ["__geoleaf_filter_none__"],
                    true,
                    false,
                ]);
                expect(stats).toEqual({ total: 2, visible: 0, filtered: 2 });
            });
        }

        it("un bloc `search` résiduel ne soustrait plus une couche au filtre", () => {
            const layer = {
                geometryType: "point",
                config: { search: { enabled: false } },
                features: [feat("a")],
            };
            const stats = newStats();
            _applyFeatureVisibilityForLayer(layer, passNone, "lyr", stats);
            expect(setLayerFilter).toHaveBeenCalled();
            expect(stats.filtered).toBe(1);
        });
    });

    describe("comptage et cas limites", () => {
        it("cumule total / visible / filtered", () => {
            const layer = { geometryType: "point", features: [feat("a"), feat("b"), feat("c")] };
            const stats = newStats();
            _applyFeatureVisibilityForLayer(layer, (f) => f.properties.id === "a", "l", stats);
            expect(stats).toEqual({ total: 3, visible: 1, filtered: 2 });
        });

        it("ne touche à rien quand la couche n'a aucune feature", () => {
            _applyFeatureVisibilityForLayer({ geometryType: "point", features: [] }, passAll, "l", {
                ...newStats(),
            });
            expect(setLayerFilter).not.toHaveBeenCalled();
            expect(updateLayerData).not.toHaveBeenCalled();
        });

        it("ne throw pas sans adaptateur, mais compte quand même", () => {
            state.adapter = null;
            const stats = newStats();
            const layer = { geometryType: "point", features: [feat("a")] };
            expect(() => _applyFeatureVisibilityForLayer(layer, passAll, "l", stats)).not.toThrow();
            expect(stats.total).toBe(1);
        });

        it("ne throw pas si l'adaptateur n'expose aucune des deux opérations", () => {
            state.adapter = {};
            const layer = { geometryType: "point", features: [feat("a"), feat("b")] };
            expect(() =>
                _applyFeatureVisibilityForLayer(layer, passNone, "l", newStats())
            ).not.toThrow();
        });
    });
});
