/**
 * Tests for config/normalization.ts — ConfigNormalizer
 * Sprint S5B.7 — consolidated ESM file (merged from normalization.test.js + normalization.esm.test.js)
 * Uses vi.hoisted() + static imports for Istanbul coverage instrumentation.
 * Covers all branches: _safeAssign, isPoiStructNormalized, _isValidLatLng,
 * _poiHasValidLocation, mapRawPoiToNormalized, normalizePoiWithMapping.
 */

const { mockLog, mockConfigStore } = vi.hoisted(() => {
    const mockLog = { warn: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() };
    const mockConfigStore = {
        getValueByPath: vi.fn((obj, path) => {
            if (!obj || !path) return undefined;
            return path
                .split(".")
                .reduce((c, k) => (c !== undefined && c !== null ? c[k] : undefined), obj);
        }),
        setValueByPath: vi.fn((obj, path, value) => {
            const keys = path.split(".");
            let cur = obj;
            for (let i = 0; i < keys.length - 1; i++) {
                if (!cur[keys[i]]) cur[keys[i]] = {};
                cur = cur[keys[i]];
            }
            cur[keys[keys.length - 1]] = value;
        }),
    };
    return { mockLog, mockConfigStore };
});

vi.mock("../../src/utils/log/index.js", () => ({ Log: mockLog }));
vi.mock("../../src/kernel/config/storage.js", () => ({
    ConfigStore: mockConfigStore,
}));

import { ConfigNormalizer } from "../../src/kernel/config/normalization.ts";

beforeEach(() => {
    vi.clearAllMocks();
    // Restore default ConfigStore mock behaviour after any test that might override it
    mockConfigStore.getValueByPath.mockImplementation((obj, path) => {
        if (!obj || !path) return undefined;
        return path
            .split(".")
            .reduce((c, k) => (c !== undefined && c !== null ? c[k] : undefined), obj);
    });
    mockConfigStore.setValueByPath.mockImplementation((obj, path, value) => {
        const keys = path.split(".");
        let cur = obj;
        for (let i = 0; i < keys.length - 1; i++) {
            if (!cur[keys[i]]) cur[keys[i]] = {};
            cur = cur[keys[i]];
        }
        cur[keys[keys.length - 1]] = value;
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// isPoiStructNormalized — early-exit and location validation branches
// ─────────────────────────────────────────────────────────────────────────────
describe("config/normalization — isPoiStructNormalized", () => {
    it("returns false for null", () => {
        expect(ConfigNormalizer.isPoiStructNormalized(null)).toBe(false);
    });
    it("returns false for undefined", () => {
        expect(ConfigNormalizer.isPoiStructNormalized(undefined)).toBe(false);
    });
    it("returns false for string (non-object)", () => {
        expect(ConfigNormalizer.isPoiStructNormalized("string")).toBe(false);
    });
    it("returns false for number (non-object)", () => {
        expect(ConfigNormalizer.isPoiStructNormalized(42)).toBe(false);
    });
    it("returns false when id is missing", () => {
        expect(ConfigNormalizer.isPoiStructNormalized({ title: "A", latlng: [48, 2] })).toBe(false);
    });
    it("returns false when id is empty string", () => {
        expect(
            ConfigNormalizer.isPoiStructNormalized({ id: "", title: "A", latlng: [48, 2] })
        ).toBe(false);
    });
    it("returns false when id is whitespace only", () => {
        expect(
            ConfigNormalizer.isPoiStructNormalized({ id: "  ", title: "A", latlng: [48, 2] })
        ).toBe(false);
    });
    it("returns false when neither title nor label present", () => {
        expect(ConfigNormalizer.isPoiStructNormalized({ id: "1", latlng: [48, 2] })).toBe(false);
    });
    it("returns false when title is empty string", () => {
        expect(
            ConfigNormalizer.isPoiStructNormalized({ id: "1", title: "", latlng: [48, 2] })
        ).toBe(false);
    });
    it("returns false when label is whitespace only", () => {
        expect(
            ConfigNormalizer.isPoiStructNormalized({ id: "1", label: "   ", latlng: [48, 2] })
        ).toBe(false);
    });
    it("returns false when no location and no latlng", () => {
        expect(ConfigNormalizer.isPoiStructNormalized({ id: "1", title: "T" })).toBe(false);
    });
    it("returns false when latlng is not an array", () => {
        expect(
            ConfigNormalizer.isPoiStructNormalized({ id: "1", title: "T", latlng: "not-array" })
        ).toBe(false);
    });
    it("returns false when latlng array has length < 2", () => {
        expect(ConfigNormalizer.isPoiStructNormalized({ id: "1", title: "T", latlng: [48] })).toBe(
            false
        );
    });
    it("returns false when latlng has non-number lat (string)", () => {
        expect(
            ConfigNormalizer.isPoiStructNormalized({ id: "1", title: "T", latlng: ["a", 2] })
        ).toBe(false);
    });
    it("returns false when latlng has NaN lat", () => {
        expect(
            ConfigNormalizer.isPoiStructNormalized({ id: "1", title: "T", latlng: [NaN, 2] })
        ).toBe(false);
    });
    it("returns false when latlng has NaN lng", () => {
        expect(
            ConfigNormalizer.isPoiStructNormalized({ id: "1", title: "T", latlng: [48, NaN] })
        ).toBe(false);
    });
    it("returns false when latlng has non-number lng (string)", () => {
        expect(
            ConfigNormalizer.isPoiStructNormalized({ id: "1", title: "T", latlng: [48, "b"] })
        ).toBe(false);
    });
    it("returns false when location.lat is string", () => {
        expect(
            ConfigNormalizer.isPoiStructNormalized({
                id: "1",
                title: "T",
                location: { lat: "invalid", lng: 2 },
            })
        ).toBe(false);
    });
    it("returns false when location.lat is NaN", () => {
        expect(
            ConfigNormalizer.isPoiStructNormalized({
                id: "1",
                title: "T",
                location: { lat: NaN, lng: 2 },
            })
        ).toBe(false);
    });
    it("returns false when location.lng is NaN", () => {
        expect(
            ConfigNormalizer.isPoiStructNormalized({
                id: "1",
                title: "T",
                location: { lat: 48, lng: NaN },
            })
        ).toBe(false);
    });
    it("returns false when location.lng is string", () => {
        expect(
            ConfigNormalizer.isPoiStructNormalized({
                id: "1",
                title: "T",
                location: { lat: 48, lng: "bad" },
            })
        ).toBe(false);
    });
    it("returns true for valid POI with latlng array", () => {
        expect(
            ConfigNormalizer.isPoiStructNormalized({
                id: "1",
                title: "Test",
                latlng: [48.85, 2.35],
            })
        ).toBe(true);
    });
    it("returns true for valid POI with location object", () => {
        expect(
            ConfigNormalizer.isPoiStructNormalized({
                id: "1",
                title: "Test",
                location: { lat: 48.85, lng: 2.35 },
            })
        ).toBe(true);
    });
    it("returns true when only label provided (no title)", () => {
        expect(
            ConfigNormalizer.isPoiStructNormalized({ id: "1", label: "Label", latlng: [48, 2] })
        ).toBe(true);
    });
    it("accepts zero coordinates (valid edge case)", () => {
        expect(
            ConfigNormalizer.isPoiStructNormalized({ id: "1", title: "T", latlng: [0, 0] })
        ).toBe(true);
    });
});

// `_safeAssign` coverage lived here until Sprint 5 (optimisation KERNEL). The helper was
// removed: it had had no production caller since 2026-02-18 (commit 15cc5cf7 dropped the
// per-POI copy for perf), and it duplicated the canonical guard `_isUnsafeKey` in
// built-in/config/storage.ts. Prototype-pollution coverage for the real write paths now
// lives in __tests__/security/{prototype-pollution,sprint1-sink-hardening}.test.js —
// against the real ConfigStore, which this file mocks (see the top-of-file mock).

// ─────────────────────────────────────────────────────────────────────────────
// mapRawPoiToNormalized — null guards and mapping logic
// ─────────────────────────────────────────────────────────────────────────────
describe("config/normalization — mapRawPoiToNormalized", () => {
    it("returns null for null rawPoi", () => {
        expect(ConfigNormalizer.mapRawPoiToNormalized(null, {})).toBeNull();
    });
    it("returns null for null mappingDef", () => {
        expect(ConfigNormalizer.mapRawPoiToNormalized({}, null)).toBeNull();
    });
    it("returns null when mappingDef is not an object (string)", () => {
        expect(ConfigNormalizer.mapRawPoiToNormalized({}, "notobj")).toBeNull();
    });
    it("returns null when mappingDef is a number", () => {
        expect(ConfigNormalizer.mapRawPoiToNormalized({}, 42)).toBeNull();
    });

    it("maps id, title and location using ConfigStore dot-path", () => {
        const rawPoi = {
            props: { id: "p1", name: "Place One" },
            geo: { lat: 48.85, lng: 2.35 },
        };
        const mappingDef = {
            id: "props.id",
            title: "props.name",
            "location.lat": "geo.lat",
            "location.lng": "geo.lng",
        };
        const result = ConfigNormalizer.mapRawPoiToNormalized(rawPoi, mappingDef);
        expect(result).not.toBeNull();
        expect(result.id).toBe("p1");
        expect(result.title).toBe("Place One");
        expect(result.location.lat).toBe(48.85);
        expect(result.location.lng).toBe(2.35);
    });

    it("skips keys whose sourcePath resolves to undefined", () => {
        const rawPoi = { props: { id: "p1" } };
        const mappingDef = { id: "props.id", title: "props.nonexistent" };
        const result = ConfigNormalizer.mapRawPoiToNormalized(rawPoi, mappingDef);
        expect(result).not.toBeNull();
        expect(result.id).toBe("p1");
        // title stays as default empty string since not mapped
        expect(result.title).toBe("");
    });

    it("ensures attributes defaults to {} when mapping target path is wrong", () => {
        // If the mapping writes something that makes attributes non-object, it resets to {}
        const rawPoi = { id: "x" };
        const mappingDef = { id: "id" };
        const result = ConfigNormalizer.mapRawPoiToNormalized(rawPoi, mappingDef);
        expect(result).not.toBeNull();
        expect(result.attributes).toEqual({});
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// normalizePoiWithMapping — routing and skip branches
// ─────────────────────────────────────────────────────────────────────────────
describe("config/normalization — normalizePoiWithMapping", () => {
    // Mapping config is ALWAYS an object of named per-source blocks { <sourceId>: { mapping } }.
    const block = (mapping) => ({ src: { mapping } });

    it("returns [] when rawPoiArray is null", () => {
        expect(ConfigNormalizer.normalizePoiWithMapping(null, block({}))).toEqual([]);
    });
    it("returns [] when rawPoiArray is a string", () => {
        expect(ConfigNormalizer.normalizePoiWithMapping("string", block({}))).toEqual([]);
    });
    it("returns [] when rawPoiArray is a number", () => {
        expect(ConfigNormalizer.normalizePoiWithMapping(42, block({}))).toEqual([]);
    });

    it("returns raw array as-is when mappingConfig is null (no mapping)", () => {
        const raw = [{ id: "1", title: "T", latlng: [48, 2] }];
        const result = ConfigNormalizer.normalizePoiWithMapping(raw, null);
        expect(result).toEqual(raw);
    });
    it("returns raw array as-is when mappingConfig is empty object (no source block)", () => {
        const raw = [{ id: "1", title: "T", latlng: [48, 2] }];
        expect(ConfigNormalizer.normalizePoiWithMapping(raw, {})).toEqual(raw);
    });
    it("returns raw array as-is when a source block's mapping is not an object", () => {
        const raw = [{ id: "1", title: "T", latlng: [48, 2] }];
        expect(
            ConfigNormalizer.normalizePoiWithMapping(raw, { src: { mapping: "invalid" } })
        ).toEqual(raw);
    });

    it("short-circuits: pushes already-normalized POI directly without re-mapping", () => {
        const raw = [{ id: "1", title: "T", latlng: [48, 2] }];
        const result = ConfigNormalizer.normalizePoiWithMapping(
            raw,
            block({ id: "id", title: "title" })
        );
        expect(result.length).toBe(1);
        expect(result[0].id).toBe("1");
    });

    it("maps raw POI to normalized structure and pushes if valid (single block auto-resolved)", () => {
        const raw = [{ src_id: "p1", src_name: "Place", lat: 48.85, lng: 2.35 }];
        const result = ConfigNormalizer.normalizePoiWithMapping(
            raw,
            block({ id: "src_id", title: "src_name", "location.lat": "lat", "location.lng": "lng" })
        );
        expect(result.length).toBe(1);
        expect(result[0].id).toBe("p1");
    });

    it("skips and warns when mapping cannot produce a valid POI", () => {
        // { x: 1 } has no id/title/location, empty mapping {} won't add them
        const raw = [{ x: 1 }];
        const result = ConfigNormalizer.normalizePoiWithMapping(raw, block({}));
        expect(result.length).toBe(0);
        expect(mockLog.warn).toHaveBeenCalledWith(
            expect.stringContaining("not normalized even after mapping"),
            expect.any(Object)
        );
    });

    it("filters out only invalid POIs, keeps valid ones", () => {
        const raw = [
            { src_id: "p1", src_name: "Good", lat: 48.85, lng: 2.35 },
            { broken: true }, // won't produce a valid POI
        ];
        const result = ConfigNormalizer.normalizePoiWithMapping(
            raw,
            block({ id: "src_id", title: "src_name", "location.lat": "lat", "location.lng": "lng" })
        );
        expect(result.length).toBe(1);
        expect(result[0].id).toBe("p1");
    });

    it("multiple blocks → resolves the requested sourceKey", () => {
        const raw = [{ a_id: "p1", a_name: "A", lat: 1, lng: 2 }];
        const cfg = {
            alpha: {
                mapping: {
                    id: "a_id",
                    title: "a_name",
                    "location.lat": "lat",
                    "location.lng": "lng",
                },
            },
            beta: {
                mapping: {
                    id: "b_id",
                    title: "b_name",
                    "location.lat": "lat",
                    "location.lng": "lng",
                },
            },
        };
        const out = ConfigNormalizer.normalizePoiWithMapping(raw, cfg, "alpha");
        expect(out.length).toBe(1);
        expect(out[0].id).toBe("p1");
    });

    it("multiple blocks WITHOUT a sourceKey → ambiguous → no-op passthrough", () => {
        const raw = [{ a_id: "p1" }];
        const cfg = { alpha: { mapping: { id: "a_id" } }, beta: { mapping: { id: "b_id" } } };
        expect(ConfigNormalizer.normalizePoiWithMapping(raw, cfg)).toBe(raw);
    });
});
