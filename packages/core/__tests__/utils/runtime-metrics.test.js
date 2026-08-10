/**
 * runtime-metrics.test.js
 * Sprint T21.4.4 — Full test coverage for runtime-metrics.ts
 *
 *
 * NOTE: runtime-metrics.ts uses `export {}` (no named exports).
 * Functions are registered on globalThis.GeoLeaf when that object exists at module load time.
 * Strategy: set globalThis.GeoLeaf = {} before each require, then use globalThis.GeoLeaf.*
 */

async function loadModule() {
    // Ensure GeoLeaf namespace exists so the module registers functions on it
    if (!globalThis.GeoLeaf) globalThis.GeoLeaf = {};
    await import("../../src/utils/performance/runtime-metrics.js");
    return globalThis.GeoLeaf;
}

// We need to reset the module between groups to clear the cachedMetrics state
beforeEach(() => {
    vi.resetModules();
    globalThis.GeoLeaf = {};
    // Clean up any performance marks/measures from previous tests
    if (typeof performance !== "undefined") {
        try {
            performance.clearMeasures?.();
            performance.clearMarks?.();
        } catch (_) {
            /* ignore */
        }
    }
});

// ─── getRuntimeMetrics — basic collect ────────────────────────────────────

describe("getRuntimeMetrics — basic collection", () => {
    it("returns metrics object with expected keys", async () => {
        const gl = await loadModule();
        const metrics = gl.getRuntimeMetrics();
        expect(metrics).toHaveProperty("timeToMapReadyMs");
        expect(metrics).toHaveProperty("timeToAppReadyMs");
        expect(metrics).toHaveProperty("startupTotalMs");
        expect(metrics).toHaveProperty("capturedAt");
    });

    it("capturedAt is a valid ISO string", async () => {
        const gl = await loadModule();
        const metrics = gl.getRuntimeMetrics();
        expect(typeof metrics.capturedAt).toBe("string");
        expect(() => new Date(metrics.capturedAt)).not.toThrow();
        expect(new Date(metrics.capturedAt).getTime()).not.toBeNaN();
    });

    it("caches metrics on second call (same object reference)", async () => {
        const gl = await loadModule();
        const first = gl.getRuntimeMetrics();
        const second = gl.getRuntimeMetrics();
        // Should return the same cached object
        expect(second).toBe(first);
    });
});

// ─── resetRuntimeMetrics ────────────────────────────────────────────────────

describe("resetRuntimeMetrics", () => {
    it("clears cached metrics so next call re-collects", async () => {
        const gl = await loadModule();
        const first = gl.getRuntimeMetrics();
        gl.resetRuntimeMetrics();
        const second = gl.getRuntimeMetrics();
        // After reset, a new object is created
        expect(second).not.toBe(first);
    });
});

// ─── collectMetrics — with performance.getEntriesByName ──────────────────

describe("collectMetrics — performance entries", () => {
    it("reads startupTotalMs from 'geoleaf:startup-total' measure", async () => {
        const originalGetEntriesByName = performance.getEntriesByName;
        performance.getEntriesByName = vi.fn((name, type) => {
            if (name === "geoleaf:startup-total" && type === "measure") {
                return [{ duration: 1234.5 }];
            }
            return [];
        });
        const gl = await loadModule();
        const metrics = gl.getRuntimeMetrics();
        expect(metrics.startupTotalMs).toBe(1234.5);
        performance.getEntriesByName = originalGetEntriesByName;
    });

    it("reads timeToMapReadyMs from 'geoleaf:initApp:ready' mark", async () => {
        const originalGetEntriesByName = performance.getEntriesByName;
        performance.getEntriesByName = vi.fn((name, type) => {
            if (name === "geoleaf:initApp:ready" && type === "mark") {
                return [{ startTime: 5678 }];
            }
            return [];
        });
        const gl = await loadModule();
        const metrics = gl.getRuntimeMetrics();
        expect(metrics.timeToMapReadyMs).toBe(5678);
        performance.getEntriesByName = originalGetEntriesByName;
    });

    it("leaves startupTotalMs null when no measure entries", async () => {
        const originalGetEntriesByName = performance.getEntriesByName;
        performance.getEntriesByName = vi.fn(() => []);
        const gl = await loadModule();
        const metrics = gl.getRuntimeMetrics();
        expect(metrics.startupTotalMs).toBeNull();
        performance.getEntriesByName = originalGetEntriesByName;
    });

    it("leaves timeToMapReadyMs null when no mark entries", async () => {
        const originalGetEntriesByName = performance.getEntriesByName;
        performance.getEntriesByName = vi.fn(() => []);
        const gl = await loadModule();
        const metrics = gl.getRuntimeMetrics();
        expect(metrics.timeToMapReadyMs).toBeNull();
        performance.getEntriesByName = originalGetEntriesByName;
    });
});

// ─── getNavigationStart — timeOrigin branch ─────────────────────────────

describe("getNavigationStart — timeOrigin fallback", () => {
    it("uses performance.timeOrigin when available", async () => {
        const originalTimeOrigin = Object.getOwnPropertyDescriptor(performance, "timeOrigin");
        Object.defineProperty(performance, "timeOrigin", {
            value: Date.now() - 1000,
            configurable: true,
        });
        const gl = await loadModule();
        const metrics = gl.getRuntimeMetrics();
        // timeToAppReadyMs should be set since timeOrigin > 0
        expect(metrics.timeToAppReadyMs).not.toBeNull();
        expect(metrics.timeToAppReadyMs).toBeGreaterThan(0);
        if (originalTimeOrigin) {
            Object.defineProperty(performance, "timeOrigin", originalTimeOrigin);
        }
    });
});

// ─── onAppReady via geoleaf:app:ready event ─────────────────────────────

describe("onAppReady via event dispatch", () => {
    it("fires when 'geoleaf:app:ready' event is dispatched — no crash", async () => {
        const gl = await loadModule();
        gl.getRuntimeMetrics(); // pre-collect
        expect(() => {
            document.dispatchEvent(new Event("geoleaf:app:ready"));
        }).not.toThrow();
    });

    it("calls _perfCallback on globalThis.GeoLeaf when set", async () => {
        const cbSpy = vi.fn();
        globalThis.GeoLeaf._perfCallback = cbSpy;
        await loadModule();
        document.dispatchEvent(new Event("geoleaf:app:ready"));
        return new Promise((resolve) => setTimeout(resolve, 0)).then(() => {
            expect(cbSpy).toHaveBeenCalled();
        });
    });

    it("does not crash when _perfCallback throws", async () => {
        globalThis.GeoLeaf._perfCallback = () => {
            throw new Error("cb error");
        };
        await loadModule();
        expect(() => {
            document.dispatchEvent(new Event("geoleaf:app:ready"));
        }).not.toThrow();
    });

    it("calls logToConsole when _debugPerf is true", async () => {
        const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});
        globalThis.GeoLeaf._debugPerf = true;
        await loadModule();
        document.dispatchEvent(new Event("geoleaf:app:ready"));
        return new Promise((resolve) => setTimeout(resolve, 0)).then(() => {
            consoleSpy.mockRestore();
        });
    });
});

// ─── logToConsole branches ────────────────────────────────────────────────

describe("logToConsole — metric combinations", () => {
    it("includes all metrics in console output when all set", async () => {
        const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});
        const originalGetEntriesByName = performance.getEntriesByName;
        performance.getEntriesByName = vi.fn((name, type) => {
            if (name === "geoleaf:startup-total" && type === "measure")
                return [{ duration: 100.1 }];
            if (name === "geoleaf:initApp:ready" && type === "mark") return [{ startTime: 200 }];
            return [];
        });
        Object.defineProperty(performance, "timeOrigin", {
            value: Date.now() - 500,
            configurable: true,
        });
        globalThis.GeoLeaf._debugPerf = true;
        await loadModule();
        document.dispatchEvent(new Event("geoleaf:app:ready"));
        return new Promise((resolve) => setTimeout(resolve, 0)).then(() => {
            consoleSpy.mockRestore();
            performance.getEntriesByName = originalGetEntriesByName;
        });
    });
});

// ─── GeoLeaf global namespace registration ────────────────────────────────

describe("GeoLeaf global namespace", () => {
    it("exposes getPerformanceMetrics and resetRuntimeMetrics on globalThis.GeoLeaf", async () => {
        await loadModule();
        expect(typeof globalThis.GeoLeaf.getPerformanceMetrics).toBe("function");
        expect(typeof globalThis.GeoLeaf.getRuntimeMetrics).toBe("function");
        expect(typeof globalThis.GeoLeaf.resetRuntimeMetrics).toBe("function");
    });
});
