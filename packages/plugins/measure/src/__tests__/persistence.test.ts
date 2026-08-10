/**
 * Tests for persistence.ts — localStorage save/restore with debounce.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { installMockGeoLeaf, uninstallMockGeoLeaf } from "./setup.js";
import { getMeasureConfig } from "../config.js";
import { initPersistence, scheduleSave, clearStorage } from "../persistence.js";

const KEY = "geoleaf.measure.fc";

function makeCollection(n = 1): GeoJSON.FeatureCollection {
    return {
        type: "FeatureCollection",
        features: Array.from({ length: n }, (_, i) => ({
            type: "Feature" as const,
            geometry: {
                type: "LineString" as const,
                coordinates: [
                    [0, 0],
                    [1, 1],
                ],
            },
            properties: {
                measureType: "distance",
                _id: `id-${i}`,
                createdAt: new Date().toISOString(),
            },
        })),
    };
}

beforeEach(() => {
    installMockGeoLeaf();
    vi.useFakeTimers();
    localStorage.clear();
});

afterEach(() => {
    uninstallMockGeoLeaf();
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
});

// ---------------------------------------------------------------------------

describe("initPersistence", () => {
    it("returns null when localStorage is empty", () => {
        const cfg = getMeasureConfig();
        expect(initPersistence(cfg)).toBeNull();
    });

    it("returns null when persist is false", () => {
        const cfg = { ...getMeasureConfig(), persist: false };
        localStorage.setItem(KEY, JSON.stringify(makeCollection()));
        expect(initPersistence(cfg)).toBeNull();
    });

    it("returns the saved features when valid FeatureCollection is stored", () => {
        const cfg = getMeasureConfig();
        const fc = makeCollection(2);
        localStorage.setItem(KEY, JSON.stringify(fc));
        const result = initPersistence(cfg);
        expect(result).toHaveLength(2);
        expect(result![0].geometry.type).toBe("LineString");
    });

    it("returns null for malformed JSON", () => {
        const cfg = getMeasureConfig();
        localStorage.setItem(KEY, "not-json{{");
        expect(initPersistence(cfg)).toBeNull();
    });

    it("returns null when stored value is not a FeatureCollection", () => {
        const cfg = getMeasureConfig();
        localStorage.setItem(
            KEY,
            JSON.stringify({ type: "Feature", geometry: null, properties: {} })
        );
        expect(initPersistence(cfg)).toBeNull();
    });
});

// ---------------------------------------------------------------------------

describe("scheduleSave", () => {
    it("writes to localStorage after 300 ms debounce", () => {
        const cfg = getMeasureConfig();
        initPersistence(cfg);
        const col = makeCollection(1);
        scheduleSave(() => col);

        expect(localStorage.getItem(KEY)).toBeNull(); // not yet
        vi.advanceTimersByTime(300);
        const stored = JSON.parse(localStorage.getItem(KEY)!);
        expect(stored.type).toBe("FeatureCollection");
        expect(stored.features).toHaveLength(1);
    });

    it("debounces: only the last call is written (last collection wins)", () => {
        const cfg = getMeasureConfig();
        initPersistence(cfg);

        scheduleSave(() => makeCollection(1)); // will be cancelled
        scheduleSave(() => makeCollection(2)); // will be cancelled
        scheduleSave(() => makeCollection(3)); // this one wins

        expect(localStorage.getItem(KEY)).toBeNull(); // not written yet
        vi.advanceTimersByTime(300);
        const stored = JSON.parse(localStorage.getItem(KEY)!);
        // Only the last call's collection (3 features) should have been written
        expect(stored.features).toHaveLength(3);
    });

    it("does not write when persist is false", () => {
        const cfg = { ...getMeasureConfig(), persist: false };
        initPersistence(cfg);
        scheduleSave(() => makeCollection(1));
        vi.advanceTimersByTime(300);
        expect(localStorage.getItem(KEY)).toBeNull();
    });

    it("skips write and warns when collection exceeds maxFeatures", () => {
        const cfg = { ...getMeasureConfig(), maxFeatures: 2 };
        initPersistence(cfg);
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        scheduleSave(() => makeCollection(3));
        vi.advanceTimersByTime(300);
        expect(localStorage.getItem(KEY)).toBeNull();
        expect(warnSpy).toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------

describe("clearStorage", () => {
    it("removes the key from localStorage", () => {
        const cfg = getMeasureConfig();
        localStorage.setItem(KEY, JSON.stringify(makeCollection()));
        clearStorage(cfg);
        expect(localStorage.getItem(KEY)).toBeNull();
    });

    it("cancels a pending scheduleSave", () => {
        const cfg = getMeasureConfig();
        initPersistence(cfg);
        scheduleSave(() => makeCollection(1));
        clearStorage(cfg); // should cancel the pending timer
        vi.advanceTimersByTime(300);
        expect(localStorage.getItem(KEY)).toBeNull();
    });
});
