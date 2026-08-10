/**
 * Tests pour config-validation (Phase 2 — coverage branches)
 */
vi.mock("../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../src/kernel/config/storage.js", () => ({
    ConfigStore: { init: vi.fn(), getAll: vi.fn(() => ({})), get: vi.fn(), set: vi.fn() },
}));
vi.mock("../../src/kernel/config/profile.js", () => ({
    ProfileManager: { init: vi.fn() },
}));

import { Config } from "../../src/kernel/config/geoleaf-config/config-core.js";
import "../../src/kernel/config/geoleaf-config/config-validation.js";

const validateConfig = Config._validateConfig;

describe("config/config-validation", () => {
    test("no-op for null/undefined", () => {
        expect(() => validateConfig(null)).not.toThrow();
        expect(() => validateConfig(undefined)).not.toThrow();
    });

    test("valid map.center passes", () => {
        expect(() => validateConfig({ map: { center: [48.85, 2.35] } })).not.toThrow();
    });

    test("invalid map.center throws", () => {
        expect(() => validateConfig({ map: { center: [48] } })).toThrow(/map\.center/);
        expect(() => validateConfig({ map: { center: "x" } })).toThrow(/map\.center/);
        expect(() => validateConfig({ map: { center: [48, "x"] } })).toThrow(/map\.center/);
    });

    test("valid map.zoom passes", () => {
        expect(() => validateConfig({ map: { zoom: 10 } })).not.toThrow();
        expect(() => validateConfig({ map: { zoom: 0 } })).not.toThrow();
        expect(() => validateConfig({ map: { zoom: 20 } })).not.toThrow();
    });

    test("invalid map.zoom throws", () => {
        expect(() => validateConfig({ map: { zoom: -1 } })).toThrow(/map\.zoom/);
        expect(() => validateConfig({ map: { zoom: 21 } })).toThrow(/map\.zoom/);
        expect(() => validateConfig({ map: { zoom: "10" } })).toThrow(/map\.zoom/);
    });

    test("map.positionFixed must be boolean", () => {
        expect(() => validateConfig({ map: { positionFixed: true } })).not.toThrow();
        expect(() => validateConfig({ map: { positionFixed: 1 } })).toThrow(/positionFixed/);
    });

    test("map.initialMaxZoom 1-20", () => {
        expect(() => validateConfig({ map: { initialMaxZoom: 10 } })).not.toThrow();
        expect(() => validateConfig({ map: { initialMaxZoom: 0 } })).toThrow(/initialMaxZoom/);
        expect(() => validateConfig({ map: { initialMaxZoom: 21 } })).toThrow(/initialMaxZoom/);
    });

    test("map.boundsMargin 0-1", () => {
        expect(() => validateConfig({ map: { boundsMargin: 0.3 } })).not.toThrow();
        expect(() => validateConfig({ map: { boundsMargin: -0.1 } })).toThrow(/boundsMargin/);
        expect(() => validateConfig({ map: { boundsMargin: 1.1 } })).toThrow(/boundsMargin/);
    });

    test("basemaps must be object", () => {
        expect(() => validateConfig({ basemaps: {} })).not.toThrow();
        expect(() => validateConfig({ basemaps: null })).toThrow(/basemaps/);
    });

    test("geojson field is ignored (removed in v2.0.0)", () => {
        // geojson validation removed — field is now an unknown passthrough
        expect(() => validateConfig({ geojson: [] })).not.toThrow();
        expect(() => validateConfig({ geojson: {} })).not.toThrow();
    });
});
