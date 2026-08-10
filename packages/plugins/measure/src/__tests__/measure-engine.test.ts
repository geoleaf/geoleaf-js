/**
 * Tests for measure-engine.ts — step-based drawing engine.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { installMockGeoLeaf, uninstallMockGeoLeaf } from "./setup.js";
import { getMeasureConfig } from "../config.js";
import { initLayers } from "../draw-layers.js";
import * as drawLayers from "../draw-layers.js";
import {
    initEngine,
    startSession,
    addVertex,
    updateEnginePreview,
    closeAsPolygon,
    finishSession,
    cancelSession,
    getSession,
    getEngineCollection,
    clearEngineCollection,
    rerenderLabels,
} from "../measure-engine.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PT_A: [number, number] = [2.3, 48.85];
const PT_B: [number, number] = [2.4, 48.85];
const PT_C: [number, number] = [2.35, 48.9];
const PT_D: [number, number] = [2.25, 48.9];

function setup() {
    const gl = installMockGeoLeaf();
    const map = gl._nativeMap;
    initLayers(map);
    initEngine(getMeasureConfig());
    return { gl, map };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
    setup();
});

afterEach(() => {
    clearEngineCollection();
    uninstallMockGeoLeaf();
    vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

describe("startSession", () => {
    it("initialises an empty session", () => {
        startSession("line");
        const s = getSession();
        expect(s).not.toBeNull();
        expect(s?.vertices).toHaveLength(0);
        expect(s?.closed).toBe(false);
        expect(s?.type).toBe("line");
    });

    it("replaces a previous open session", () => {
        startSession("line");
        addVertex(PT_A);
        startSession("polygon");
        expect(getSession()?.vertices).toHaveLength(0);
        expect(getSession()?.type).toBe("polygon");
    });
});

// ---------------------------------------------------------------------------
// addVertex
// ---------------------------------------------------------------------------

describe("addVertex", () => {
    it("appends vertices to the session", () => {
        startSession("line");
        addVertex(PT_A);
        addVertex(PT_B);
        expect(getSession()?.vertices).toHaveLength(2);
    });

    it("does nothing if there is no active session", () => {
        addVertex(PT_A);
        expect(getSession()).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// updateEnginePreview
// ---------------------------------------------------------------------------

describe("updateEnginePreview", () => {
    it("no-op when session is empty", () => {
        startSession("line");
        // Should not throw
        expect(() => updateEnginePreview(PT_B)).not.toThrow();
    });

    it("no-op when there is no active session", () => {
        expect(() => updateEnginePreview(PT_B)).not.toThrow();
    });

    it("updates preview after first vertex", () => {
        const spy = vi.spyOn(drawLayers, "updatePreview");
        startSession("line");
        addVertex(PT_A);
        updateEnginePreview(PT_B);
        expect(spy).toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// closeAsPolygon
// ---------------------------------------------------------------------------

describe("closeAsPolygon", () => {
    it("marks session as closed and updates type", () => {
        startSession("line");
        addVertex(PT_A);
        addVertex(PT_B);
        addVertex(PT_C);
        closeAsPolygon();
        const s = getSession();
        expect(s?.closed).toBe(true);
        expect(s?.type).toBe("polygon");
    });

    it("requires at least 3 vertices", () => {
        startSession("line");
        addVertex(PT_A);
        addVertex(PT_B);
        closeAsPolygon(); // 2 vertices — should be a no-op
        expect(getSession()?.closed).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// finishSession
// ---------------------------------------------------------------------------

describe("finishSession", () => {
    it("returns null if no session or fewer than 2 vertices", () => {
        expect(finishSession()).toBeNull();
        startSession("line");
        addVertex(PT_A);
        expect(finishSession()).toBeNull();
    });

    it("produces a LineString MeasureFeature", () => {
        startSession("line");
        addVertex(PT_A);
        addVertex(PT_B);
        const feat = finishSession();
        expect(feat).not.toBeNull();
        expect(feat?.geometry.type).toBe("LineString");
        expect(feat?.properties.measureType).toBe("distance");
        expect(feat?.properties.lengthM).toBeGreaterThan(0);
    });

    it("produces a Polygon MeasureFeature when closed", () => {
        startSession("line");
        addVertex(PT_A);
        addVertex(PT_B);
        addVertex(PT_C);
        closeAsPolygon();
        const feat = finishSession();
        expect(feat?.geometry.type).toBe("Polygon");
        expect(feat?.properties.areaM2).toBeGreaterThan(0);
    });

    it("adds feature to collection and resets session", () => {
        startSession("line");
        addVertex(PT_A);
        addVertex(PT_B);
        finishSession();
        expect(getSession()).toBeNull();
        const fc = getEngineCollection();
        expect(fc.features).toHaveLength(1);
    });

    it("accumulates multiple measurements", () => {
        startSession("line");
        addVertex(PT_A);
        addVertex(PT_B);
        finishSession();

        startSession("line");
        addVertex(PT_C);
        addVertex(PT_D);
        finishSession();

        expect(getEngineCollection().features).toHaveLength(2);
    });
});

// ---------------------------------------------------------------------------
// cancelSession
// ---------------------------------------------------------------------------

describe("cancelSession", () => {
    it("resets the session to null", () => {
        startSession("line");
        addVertex(PT_A);
        cancelSession();
        expect(getSession()).toBeNull();
    });

    it("does not affect the collection", () => {
        startSession("line");
        addVertex(PT_A);
        addVertex(PT_B);
        finishSession();

        startSession("line");
        addVertex(PT_C);
        cancelSession();

        expect(getEngineCollection().features).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// getEngineCollection
// ---------------------------------------------------------------------------

describe("getEngineCollection", () => {
    it("returns RFC 7946 FeatureCollection structure", () => {
        const fc = getEngineCollection();
        expect(fc.type).toBe("FeatureCollection");
        expect(Array.isArray(fc.features)).toBe(true);
    });

    it("returns a deep copy (mutations don't affect internal state)", () => {
        startSession("line");
        addVertex(PT_A);
        addVertex(PT_B);
        finishSession();
        const fc = getEngineCollection();
        fc.features[0].properties = {};
        // Internal collection should be unchanged
        const fc2 = getEngineCollection();
        expect(fc2.features[0].properties?.measureType).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// clearEngineCollection
// ---------------------------------------------------------------------------

describe("clearEngineCollection", () => {
    it("empties the collection", () => {
        startSession("line");
        addVertex(PT_A);
        addVertex(PT_B);
        finishSession();
        clearEngineCollection();
        expect(getEngineCollection().features).toHaveLength(0);
    });

    it("resets the session", () => {
        startSession("line");
        addVertex(PT_A);
        clearEngineCollection();
        expect(getSession()).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// rerenderLabels
// ---------------------------------------------------------------------------

describe("rerenderLabels", () => {
    it("does not throw with a finished feature", () => {
        startSession("line");
        addVertex(PT_A);
        addVertex(PT_B);
        finishSession();
        expect(() => rerenderLabels({ distance: "km", area: "ha" })).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// draw-layers branch coverage — updatePreview edge cases
// ---------------------------------------------------------------------------

describe("updatePreview branches", () => {
    it("empty coords clears preview without throwing", () => {
        expect(() => drawLayers.updatePreview([])).not.toThrow();
    });

    it("closed=true appends closing segment without throwing", () => {
        expect(() =>
            drawLayers.updatePreview(
                [
                    [2.3, 48.85],
                    [2.4, 48.85],
                ],
                true
            )
        ).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// getMeasureConfig — branch coverage
// ---------------------------------------------------------------------------

describe("getMeasureConfig — enabledTools array filter", () => {
    it("filters enabledTools when a valid array is provided in config", () => {
        (globalThis as any).GeoLeaf.Config.get.mockImplementation((key: string, def: unknown) => {
            if (key === "measureConfig")
                return { enabledTools: ["distance", "polygon", "unknown-tool"] };
            return def;
        });
        const cfg = getMeasureConfig();
        expect(cfg.enabledTools).toContain("distance");
        expect(cfg.enabledTools).toContain("polygon");
        expect(cfg.enabledTools).not.toContain("unknown-tool");
    });
});
