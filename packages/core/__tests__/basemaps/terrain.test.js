/**
 * Tests for basemaps/terrain.ts
 *
 * Covers all P1/P2 cases from TERRAIN3D_FEATURE_SPEC §6:
 *  T01 – activateTerrain nominal
 *  T02 – activateTerrain idempotent source
 *  T03 – activateTerrain invalid map guard
 *  T04 – activateTerrain enabled=false guard
 *  T05 – activateTerrain missing demUrl guard
 *  T06 – deactivateTerrain nominal + deferred removeSource
 *  T07 – deactivateTerrain invalid map guard
 *  T08 – deactivateTerrain skips removeSource when source absent
 *  T09 – resolveTerrainConfig returns null (not enabled)
 *  T10 – resolveTerrainConfig warns on type "tile" + enabled
 *  T11 – resolveTerrainConfig errors on missing demUrl
 *  T12 – resolveTerrainConfig returns config when valid
 *  T13 – _resetTerrainStateForTesting clears state (test helper)
 */

const Log = vi.hoisted(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
}));

vi.mock("../../src/utils/log/index.js", () => ({ Log }));

import {
    isTerrainActive,
    getActiveTerrainBasemapKey,
    activateTerrain,
    deactivateTerrain,
    resolveTerrainConfig,
    _resetTerrainStateForTesting,
} from "../../src/kernel/basemaps/terrain.ts";

// ─── Helper: mock map ─────────────────────────────────────────────────────────

const TERRAIN_SOURCE_ID = "terrain-dem";

/** Creates a minimal mock of a native maplibregl.Map. */
function makeMockMap({ sourceExists = false } = {}) {
    return {
        addSource: vi.fn(),
        removeSource: vi.fn(),
        getSource: vi.fn((id) => (id === TERRAIN_SOURCE_ID && sourceExists ? {} : null)),
        setTerrain: vi.fn(),
        easeTo: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        once: vi.fn((event, cb) => {
            // Immediately invoke the callback to simulate the render event
            if (event === "render") cb();
        }),
    };
}

/** Minimal valid TerrainConfig with a demUrl. */
const validConfig = {
    enabled: true,
    demUrl: "https://example.com/tiles/{z}/{x}/{y}.png",
    demEncoding: "terrarium",
    exaggeration: 1.5,
    pitch: 45,
    bearing: 0,
};

// ─── Reset state before each test ─────────────────────────────────────────────

beforeEach(() => {
    vi.clearAllMocks();
    _resetTerrainStateForTesting();
});

// ─── isTerrainActive / getActiveTerrainBasemapKey — initial state ─────────────

describe("initial state", () => {
    it("T-init: isTerrainActive returns false before any activation", () => {
        expect(isTerrainActive()).toBe(false);
    });

    it("T-init: getActiveTerrainBasemapKey returns null before any activation", () => {
        expect(getActiveTerrainBasemapKey()).toBeNull();
    });
});

// ─── activateTerrain ─────────────────────────────────────────────────────────

describe("activateTerrain()", () => {
    it("T01 – nominal: adds source, calls setTerrain, easeTo, sets state", () => {
        const map = makeMockMap();

        activateTerrain(map, validConfig, "ign-plan");

        expect(map.addSource).toHaveBeenCalledWith(TERRAIN_SOURCE_ID, {
            type: "raster-dem",
            tiles: [validConfig.demUrl],
            encoding: "terrarium",
            tileSize: 256,
            maxzoom: 15,
        });
        expect(map.setTerrain).toHaveBeenCalledWith({
            source: TERRAIN_SOURCE_ID,
            exaggeration: 1.5,
        });
        expect(map.easeTo).toHaveBeenCalledWith({ pitch: 45, bearing: 0 });
        expect(isTerrainActive()).toBe(true);
        expect(getActiveTerrainBasemapKey()).toBe("ign-plan");
    });

    it("T02 – idempotent: does not call addSource if source already exists", () => {
        const map = makeMockMap({ sourceExists: true });

        activateTerrain(map, validConfig, "ign-plan");

        expect(map.addSource).not.toHaveBeenCalled();
        expect(map.setTerrain).toHaveBeenCalled();
        expect(isTerrainActive()).toBe(true);
    });

    it("T03 – guard: invalid map → logs warn, does not update state", () => {
        activateTerrain(null, validConfig, "ign-plan");

        expect(Log.warn).toHaveBeenCalled();
        expect(isTerrainActive()).toBe(false);
    });

    it("T04 – guard: enabled=false → logs warn, does not activate", () => {
        const map = makeMockMap();
        const disabledConfig = { ...validConfig, enabled: false };

        activateTerrain(map, disabledConfig, "ign-plan");

        expect(Log.warn).toHaveBeenCalled();
        expect(map.setTerrain).not.toHaveBeenCalled();
        expect(isTerrainActive()).toBe(false);
    });

    it("T05 – guard: missing demUrl → logs warn, does not activate", () => {
        const map = makeMockMap();
        const noDemUrl = { ...validConfig, demUrl: undefined };

        activateTerrain(map, noDemUrl, "ign-plan");

        expect(Log.warn).toHaveBeenCalled();
        expect(map.addSource).not.toHaveBeenCalled();
        expect(isTerrainActive()).toBe(false);
    });

    it("T01b – applies defaults for optional fields (encoding/exaggeration/pitch/bearing)", () => {
        const map = makeMockMap();
        const minimalConfig = { enabled: true, demUrl: validConfig.demUrl };

        activateTerrain(map, minimalConfig, "ign-plan");

        expect(map.addSource).toHaveBeenCalledWith(
            TERRAIN_SOURCE_ID,
            expect.objectContaining({ encoding: "terrarium", tileSize: 256 })
        );
        expect(map.setTerrain).toHaveBeenCalledWith(expect.objectContaining({ exaggeration: 1.5 }));
        expect(map.easeTo).toHaveBeenCalledWith({ pitch: 45, bearing: 0 });
    });
});

// ─── deactivateTerrain ────────────────────────────────────────────────────────

describe("deactivateTerrain()", () => {
    it("T06 – nominal: setTerrain(null) before removeSource, resets state", () => {
        const setTerrainCallOrder = [];
        const removeSourceCallOrder = [];

        const map = makeMockMap({ sourceExists: true });
        map.setTerrain = vi.fn(() => setTerrainCallOrder.push("setTerrain"));
        map.removeSource = vi.fn(() => removeSourceCallOrder.push("removeSource"));
        // Make getSource return the source (exists after activation)
        map.getSource = vi.fn((id) => (id === TERRAIN_SOURCE_ID ? {} : null));

        // Activate first
        activateTerrain(map, validConfig, "ign-plan");
        vi.clearAllMocks();

        const order = [];
        map.setTerrain = vi.fn(() => order.push("setTerrain(null)"));
        map.removeSource = vi.fn(() => order.push("removeSource"));
        map.getSource = vi.fn((id) => (id === TERRAIN_SOURCE_ID ? {} : null));
        map.off = vi.fn();
        map.once = vi.fn((event, cb) => {
            if (event === "render") cb();
        });

        deactivateTerrain(map);

        // setTerrain(null) must precede removeSource
        expect(order[0]).toBe("setTerrain(null)");
        expect(order[1]).toBe("removeSource");
        expect(map.setTerrain).toHaveBeenCalledWith(null);
        expect(map.removeSource).toHaveBeenCalledWith(TERRAIN_SOURCE_ID);
        expect(map.easeTo).toHaveBeenCalledWith({ pitch: 0, bearing: 0 });
        expect(isTerrainActive()).toBe(false);
        expect(getActiveTerrainBasemapKey()).toBeNull();
    });

    it("T07 – guard: invalid map → logs warn, does not throw", () => {
        expect(() => deactivateTerrain(null)).not.toThrow();
        expect(Log.warn).toHaveBeenCalled();
    });

    it("T08 – skips removeSource when source is not present", () => {
        const map = makeMockMap({ sourceExists: false });
        map.getSource = vi.fn(() => null);

        deactivateTerrain(map);

        expect(map.setTerrain).toHaveBeenCalledWith(null);
        expect(map.removeSource).not.toHaveBeenCalled();
    });
});

// ─── resolveTerrainConfig ─────────────────────────────────────────────────────

describe("resolveTerrainConfig()", () => {
    it("T09 – returns null when terrain.enabled is false", () => {
        const result = resolveTerrainConfig({ terrain: { enabled: false } }, "test-key");
        expect(result).toBeNull();
    });

    it("T09b – returns null when terrain config is absent", () => {
        const result = resolveTerrainConfig({ type: "tile" }, "test-key");
        expect(result).toBeNull();
    });

    it("T10 – type 'tile' with terrain.enabled=true returns config (DEM works on any basemap)", () => {
        const terrainConfig = { enabled: true, demUrl: "https://example.com/dem" };
        const def = {
            type: "tile",
            terrain: terrainConfig,
        };

        const result = resolveTerrainConfig(def, "terrain3d");

        expect(result).toBe(terrainConfig);
        expect(Log.warn).not.toHaveBeenCalled();
        expect(Log.error).not.toHaveBeenCalled();
    });

    it("T11 – errors and returns null when demUrl is missing", () => {
        const def = {
            type: "maplibre",
            terrain: { enabled: true },
        };

        const result = resolveTerrainConfig(def, "no-dem");

        expect(result).toBeNull();
        expect(Log.error).toHaveBeenCalledWith(expect.stringContaining("demUrl"));
    });

    it("T12 – returns the TerrainConfig when valid", () => {
        const terrainConfig = {
            enabled: true,
            demUrl: "https://example.com/dem/{z}/{x}/{y}.png",
            exaggeration: 2.0,
        };
        const def = { type: "maplibre", terrain: terrainConfig };

        const result = resolveTerrainConfig(def, "ign-plan");

        expect(result).toBe(terrainConfig);
        expect(Log.warn).not.toHaveBeenCalled();
        expect(Log.error).not.toHaveBeenCalled();
    });
});

// ─── _resetTerrainStateForTesting ─────────────────────────────────────────────

describe("_resetTerrainStateForTesting()", () => {
    it("T13 – clears isActive and activeBasemapKey", () => {
        const map = makeMockMap();
        activateTerrain(map, validConfig, "ign-plan");
        expect(isTerrainActive()).toBe(true);
        expect(getActiveTerrainBasemapKey()).toBe("ign-plan");

        _resetTerrainStateForTesting();

        expect(isTerrainActive()).toBe(false);
        expect(getActiveTerrainBasemapKey()).toBeNull();
    });
});
