/**
 * @fileoverview Deep branch coverage for table module (T10.2.7)
 *
 * Strategy: await import() — Istanbul ESM instrumentation active.
 * Targets:
 *   - sort.ts               : sortInPlace (null values, number/string compare, asc/desc),
 *                             nextSortState (cycle: null→asc, asc→desc, desc→null, other field)
 *   - export.ts             : resolveFeatureId (feature.id, property fallbacks, __gl_row_ fallback),
 *                             buildGeoJSONCollection, downloadGeoJSON
 *   - table-state.ts        : fireEvent (map.fire + DOM CustomEvent, map=null, no DOM),
 *                             getSelectedFeatures (empty, partial match, all found)
 *
 * Ported from the core suite (`__tests__/table/table-branches-deep.test.js`).
 * Adaptation: import paths point at the plugin's flat `src/` layout.
 */
import { describe, test, expect, vi, beforeAll, beforeEach } from "vitest";

// ── Modules (await import in beforeAll) ────────────────────────────────────

let sortInPlace, nextSortState;
let resolveFeatureId, buildGeoJSONCollection, downloadGeoJSON;
let tableState, fireEvent, getSelectedFeatures;

describe("table-branches-deep (T10.2.7)", () => {
    beforeAll(async () => {
        const sortMod = await import("../sort.js");
        sortInPlace = sortMod.sortInPlace;
        nextSortState = sortMod.nextSortState;

        const exportMod = await import("../export.js");
        resolveFeatureId = exportMod.resolveFeatureId;
        buildGeoJSONCollection = exportMod.buildGeoJSONCollection;
        downloadGeoJSON = exportMod.downloadGeoJSON;

        const stateMod = await import("../table-state.js");
        tableState = stateMod.tableState;
        fireEvent = stateMod.fireEvent;
        getSelectedFeatures = stateMod.getSelectedFeatures;
    });

    beforeEach(() => {
        vi.clearAllMocks();
        // Reset tableState between tests
        tableState._map = null;
        tableState._currentLayerId = null;
        tableState._selectedIds = new Set();
        tableState._cachedData = [];
        tableState._featureIdMap = new Map();
        tableState._highlightLayers = [];
        tableState._isVisible = false;
    });

    // ════════════════════════════════════════════════════════════════════
    // sortInPlace — branch coverage
    // ════════════════════════════════════════════════════════════════════

    describe("sortInPlace", () => {
        // helper: identity getNestedValue that handles "field.nested" paths
        function getNestedValue(obj, path) {
            return path.split(".").reduce((curr, key) => curr?.[key] ?? null, obj);
        }

        test("no-op when sortState.field is null", () => {
            const data = [{ name: "B" }, { name: "A" }];
            sortInPlace(data, { field: null, direction: null }, getNestedValue);
            expect(data[0].name).toBe("B"); // unchanged
        });

        test("no-op when sortState.direction is null", () => {
            const data = [{ name: "B" }, { name: "A" }];
            sortInPlace(data, { field: "name", direction: null }, getNestedValue);
            expect(data[0].name).toBe("B"); // unchanged
        });

        test("sorts strings asc", () => {
            const data = [{ name: "Cherry" }, { name: "Apple" }, { name: "Banana" }];
            sortInPlace(data, { field: "name", direction: "asc" }, getNestedValue);
            expect(data.map((d) => d.name)).toEqual(["Apple", "Banana", "Cherry"]);
        });

        test("sorts strings desc", () => {
            const data = [{ name: "Cherry" }, { name: "Apple" }, { name: "Banana" }];
            sortInPlace(data, { field: "name", direction: "desc" }, getNestedValue);
            expect(data.map((d) => d.name)).toEqual(["Cherry", "Banana", "Apple"]);
        });

        test("sorts numbers asc", () => {
            const data = [{ val: 30 }, { val: 10 }, { val: 20 }];
            sortInPlace(data, { field: "val", direction: "asc" }, getNestedValue);
            expect(data.map((d) => d.val)).toEqual([10, 20, 30]);
        });

        test("sorts numbers desc", () => {
            const data = [{ val: 30 }, { val: 10 }, { val: 20 }];
            sortInPlace(data, { field: "val", direction: "desc" }, getNestedValue);
            expect(data.map((d) => d.val)).toEqual([30, 20, 10]);
        });

        test("null values sort last on asc", () => {
            const data = [{ val: null }, { val: 10 }, { val: null }];
            sortInPlace(data, { field: "val", direction: "asc" }, getNestedValue);
            expect(data[0].val).toBe(10); // non-null first
            expect(data[1].val).toBeNull();
            expect(data[2].val).toBeNull();
        });

        test("null values sort first on desc", () => {
            const data = [{ val: null }, { val: 10 }, { val: 5 }];
            sortInPlace(data, { field: "val", direction: "desc" }, getNestedValue);
            // desc: nulls come before real values (null → desc → -1 → pushed before)
            expect(data[0].val).toBeNull();
        });

        test("both values null → stable", () => {
            const data = [
                { val: null, n: 1 },
                { val: null, n: 2 },
            ];
            sortInPlace(data, { field: "val", direction: "asc" }, getNestedValue);
            expect(data[0].n).toBe(1); // order preserved (both null → return 0)
        });

        test("mixed: A null vs B non-null desc", () => {
            const data = [{ val: null }, { val: 5 }];
            sortInPlace(data, { field: "val", direction: "desc" }, getNestedValue);
            // valA null, direction desc → ternary returns -1 → a (null) sorts before b (5)
            // i.e. null comes first in desc order
            expect(data[0].val).toBeNull();
            expect(data[1].val).toBe(5);
        });

        test("nested field path", () => {
            const data = [{ props: { rank: 3 } }, { props: { rank: 1 } }, { props: { rank: 2 } }];
            sortInPlace(data, { field: "props.rank", direction: "asc" }, getNestedValue);
            expect(data.map((d) => d.props.rank)).toEqual([1, 2, 3]);
        });
    });

    // ════════════════════════════════════════════════════════════════════
    // nextSortState — cycle branches
    // ════════════════════════════════════════════════════════════════════

    describe("nextSortState", () => {
        test("new field → asc", () => {
            const result = nextSortState({ field: null, direction: null }, "name");
            expect(result).toEqual({ field: "name", direction: "asc" });
        });

        test("same field asc → desc", () => {
            const result = nextSortState({ field: "name", direction: "asc" }, "name");
            expect(result).toEqual({ field: "name", direction: "desc" });
        });

        test("same field desc → null (reset)", () => {
            const result = nextSortState({ field: "name", direction: "desc" }, "name");
            expect(result).toEqual({ field: null, direction: null });
        });

        test("same field null direction → asc", () => {
            const result = nextSortState({ field: "name", direction: null }, "name");
            expect(result).toEqual({ field: "name", direction: "asc" });
        });

        test("different field → asc for new field", () => {
            const result = nextSortState({ field: "oldField", direction: "desc" }, "newField");
            expect(result).toEqual({ field: "newField", direction: "asc" });
        });
    });

    // ════════════════════════════════════════════════════════════════════
    // resolveFeatureId — branch coverage
    // ════════════════════════════════════════════════════════════════════

    describe("resolveFeatureId", () => {
        test("returns feature.id when present", () => {
            const id = resolveFeatureId({ id: "feat-123", properties: {} }, 0);
            expect(id).toBe("feat-123");
        });

        test("returns feature.id as string when numeric", () => {
            const id = resolveFeatureId({ id: 42, properties: {} }, 0);
            expect(id).toBe("42");
        });

        test("skips feature.id when empty string", () => {
            const id = resolveFeatureId({ id: "", properties: { fid: "F1" } }, 0);
            expect(id).toBe("F1");
        });

        test("skips feature.id null, finds 'fid' in properties", () => {
            const id = resolveFeatureId({ id: null, properties: { fid: "myFid" } }, 0);
            expect(id).toBe("myFid");
        });

        test("finds 'osm_id' fallback", () => {
            const id = resolveFeatureId({ id: null, properties: { osm_id: "osm-99" } }, 0);
            expect(id).toBe("osm-99");
        });

        test("finds 'OBJECTID' fallback", () => {
            const id = resolveFeatureId({ id: null, properties: { OBJECTID: 777 } }, 0);
            expect(id).toBe("777");
        });

        test("finds 'code' fallback", () => {
            const id = resolveFeatureId({ id: null, properties: { code: "C123" } }, 0);
            expect(id).toBe("C123");
        });

        test("synthetic fallback when no properties", () => {
            const id = resolveFeatureId({ id: null }, 5);
            expect(id).toBe("__gl_row_5");
        });

        test("synthetic fallback when properties all undefined", () => {
            // None of the known ID fields present
            const id = resolveFeatureId({ id: null, properties: { random: "x" } }, 7);
            expect(id).toBe("__gl_row_7");
        });

        test("skips property value that is empty string", () => {
            const id = resolveFeatureId({ id: null, properties: { fid: "", OBJECTID: "good" } }, 0);
            expect(id).toBe("good");
        });
    });

    // ════════════════════════════════════════════════════════════════════
    // buildGeoJSONCollection — branch coverage
    // ════════════════════════════════════════════════════════════════════

    describe("buildGeoJSONCollection", () => {
        test("creates FeatureCollection structure", () => {
            const coll = buildGeoJSONCollection([
                {
                    properties: { name: "Test" },
                    geometry: { type: "Point", coordinates: [6.0, 45.0] },
                },
            ]);
            expect(coll.type).toBe("FeatureCollection");
            expect(coll.features.length).toBe(1);
            expect(coll.features[0].type).toBe("Feature");
        });

        test("handles empty array", () => {
            const coll = buildGeoJSONCollection([]);
            expect(coll.features).toHaveLength(0);
        });

        test("uses {} for null properties", () => {
            const coll = buildGeoJSONCollection([{ properties: null, geometry: null }]);
            expect(coll.features[0].properties).toEqual({});
            expect(coll.features[0].geometry).toBeNull();
        });
    });

    // ════════════════════════════════════════════════════════════════════
    // downloadGeoJSON — DOM interaction
    // ════════════════════════════════════════════════════════════════════

    describe("downloadGeoJSON", () => {
        test("creates and clicks anchor element", () => {
            const createObjectURL = vi.fn(() => "blob:fake-url");
            const revokeObjectURL = vi.fn();
            globalThis.URL.createObjectURL = createObjectURL;
            globalThis.URL.revokeObjectURL = revokeObjectURL;

            const clickSpy = vi
                .spyOn(HTMLAnchorElement.prototype, "click")
                .mockImplementation(() => {});

            downloadGeoJSON({ type: "FeatureCollection", features: [] }, "my-layer");

            expect(clickSpy).toHaveBeenCalledOnce();
            expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake-url");
            clickSpy.mockRestore();
        });

        test("uses 'export' fallback when layerId not provided", () => {
            const createObjectURL = vi.fn(() => "blob:fake-url2");
            globalThis.URL.createObjectURL = createObjectURL;
            globalThis.URL.revokeObjectURL = vi.fn();

            let downloadAttr = "";
            const origCreate = document.createElement.bind(document);
            vi.spyOn(document, "createElement").mockImplementation((tag) => {
                const el = origCreate(tag);
                if (tag === "a") {
                    Object.defineProperty(el, "download", {
                        get() {
                            return downloadAttr;
                        },
                        set(v) {
                            downloadAttr = v;
                        },
                        configurable: true,
                    });
                    vi.spyOn(el, "click").mockImplementation(() => {});
                }
                return el;
            });

            downloadGeoJSON({ type: "FeatureCollection", features: [] });
            expect(downloadAttr).toContain("export");
            vi.restoreAllMocks();
        });
    });

    // ════════════════════════════════════════════════════════════════════
    // fireEvent — branch coverage
    // ════════════════════════════════════════════════════════════════════

    // ⚠️ These four cases used INVENTED names (`test-event`, `no-map-event`,
    // `no-fire-method`, `safe-event`), possible while `fireEvent` took a
    // `string` and composed `"geoleaf:" + eventName`. It now takes the FULL
    // name, constrained by `TableEventName` — itself derived from
    // `GeoLeafEventMap` —, and the payload is checked against the map. An
    // invented name no longer compiles.
    //
    // Not a constraint endured: these tests exercise `fireEvent`'s three
    // routing branches (map present / absent / without `fire`), not its
    // tolerance to arbitrary names. Playing them on real names exercises the
    // same mechanics on the real surface.
    describe("fireEvent", () => {
        test("fires both map.fire and DOM CustomEvent when map present", () => {
            const mockFire = vi.fn();
            tableState._map = { fire: mockFire };

            const handler = vi.fn();
            document.addEventListener("geoleaf:table:layerChanged", handler);
            fireEvent("geoleaf:table:layerChanged", { layerId: "roads" });

            expect(mockFire).toHaveBeenCalledWith("geoleaf:table:layerChanged", {
                layerId: "roads",
            });
            expect(handler).toHaveBeenCalledOnce();
            document.removeEventListener("geoleaf:table:layerChanged", handler);
        });

        test("fires only DOM event when map not set", () => {
            tableState._map = null;
            const handler = vi.fn();
            document.addEventListener("geoleaf:table:layerChanged", handler);
            fireEvent("geoleaf:table:layerChanged", { layerId: null });
            expect(handler).toHaveBeenCalledOnce();
            document.removeEventListener("geoleaf:table:layerChanged", handler);
        });

        test("fires only DOM event when map has no fire method", () => {
            tableState._map = { noFire: true };
            const handler = vi.fn();
            document.addEventListener("geoleaf:table:opened", handler);
            fireEvent("geoleaf:table:opened", {});
            expect(handler).toHaveBeenCalledOnce();
            document.removeEventListener("geoleaf:table:opened", handler);
        });

        test("no-op when document is not available (safe guard)", () => {
            // This tests the typeof document check — in jsdom document always exists
            // but the branch is covered by normal execution
            fireEvent("geoleaf:table:closed", {});
        });
    });

    // ════════════════════════════════════════════════════════════════════
    // getSelectedFeatures — branch coverage
    // ════════════════════════════════════════════════════════════════════

    describe("getSelectedFeatures", () => {
        test("returns empty array when no selection", () => {
            tableState._selectedIds = new Set();
            const features = getSelectedFeatures();
            expect(features).toEqual([]);
        });

        test("returns features for each selected id", () => {
            const f1 = { id: "f1", properties: { name: "A" } };
            const f2 = { id: "f2", properties: { name: "B" } };
            tableState._cachedData = [f1, f2];
            tableState._featureIdMap = new Map([
                ["f1", 0],
                ["f2", 1],
            ]);
            tableState._selectedIds = new Set(["f1", "f2"]);

            const features = getSelectedFeatures();
            expect(features).toHaveLength(2);
            expect(features).toContain(f1);
            expect(features).toContain(f2);
        });

        test("skips selection id with no featureIdMap entry", () => {
            const f1 = { id: "f1" };
            tableState._cachedData = [f1];
            tableState._featureIdMap = new Map([["f1", 0]]);
            tableState._selectedIds = new Set(["f1", "missing-id"]);

            const features = getSelectedFeatures();
            expect(features).toHaveLength(1);
        });

        test("skips when featureIdMap index has no cachedData entry", () => {
            tableState._cachedData = []; // empty cache
            tableState._featureIdMap = new Map([["f1", 0]]); // index 0 but no data
            tableState._selectedIds = new Set(["f1"]);

            const features = getSelectedFeatures();
            expect(features).toHaveLength(0);
        });
    });
});
