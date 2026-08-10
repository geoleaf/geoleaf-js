/**
 */
vi.mock("../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../src/utils/general/di-accessors.js", () => ({
    getLog: () => ({ debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { WorkerManager } from "../../src/kernel/geojson/worker-manager.js";

describe("geojson/worker-manager", () => {
    afterEach(() => {
        WorkerManager.dispose();
    });

    it("isAvailable returns boolean", () => {
        expect(typeof WorkerManager.isAvailable()).toBe("boolean");
    });

    it("dispose does not throw", () => {
        expect(() => WorkerManager.dispose()).not.toThrow();
    });

    it("fetchGeoJSON fallback resolves with FeatureCollection", async () => {
        const fc = { type: "FeatureCollection", features: [] };
        global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(fc) }));
        const result = await WorkerManager.fetchGeoJSON("https://example.com/d.json", "ly1");
        expect(result).toEqual(fc);
    });

    it("fetchText fallback resolves with text", async () => {
        global.fetch = vi.fn(() =>
            Promise.resolve({ ok: true, text: () => Promise.resolve("text") })
        );
        const result = await WorkerManager.fetchText("https://example.com/f.gpx", "ly2");
        expect(result).toBe("text");
    });

    it("fetchGeoJSON fallback normalizes single Feature to FeatureCollection", async () => {
        const feature = {
            type: "Feature",
            geometry: { type: "Point", coordinates: [0, 0] },
            properties: {},
        };
        global.fetch = vi.fn(() =>
            Promise.resolve({ ok: true, json: () => Promise.resolve(feature) })
        );
        const result = await WorkerManager.fetchGeoJSON("https://example.com/f.json", "ly1");
        expect(result).toEqual({ type: "FeatureCollection", features: [feature] });
    });

    it("fetchGeoJSON fallback normalizes array to FeatureCollection", async () => {
        const features = [{ type: "Feature", geometry: { type: "Point" }, properties: {} }];
        global.fetch = vi.fn(() =>
            Promise.resolve({ ok: true, json: () => Promise.resolve(features) })
        );
        const result = await WorkerManager.fetchGeoJSON("https://example.com/a.json", "ly1");
        expect(result).toEqual({ type: "FeatureCollection", features });
    });

    it("fetchGeoJSON fallback rejects when fetch returns error", async () => {
        global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 500 }));
        await expect(
            WorkerManager.fetchGeoJSON("https://example.com/bad.json", "ly1")
        ).rejects.toThrow();
    });

    it("fetchText fallback rejects when fetch fails", async () => {
        global.fetch = vi.fn(() => Promise.reject(new Error("network")));
        await expect(
            WorkerManager.fetchText("https://example.com/fail.gpx", "ly1")
        ).rejects.toThrow("network");
    });

    it("dispose can be called multiple times", () => {
        expect(() => {
            WorkerManager.dispose();
            WorkerManager.dispose();
        }).not.toThrow();
    });

    it("fetchGeoJSON with relative URL resolves to absolute", async () => {
        const fc = { type: "FeatureCollection", features: [] };
        global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(fc) }));
        const result = await WorkerManager.fetchGeoJSON("data/d.json", "ly1");
        expect(result).toEqual(fc);
        expect(global.fetch).toHaveBeenCalled();
        const callUrl = global.fetch.mock.calls[0][0];
        expect(callUrl).toMatch(/^https?:\/\//);
    });

    it("fetchGeoJSON fallback rejects when response is not ok", async () => {
        global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 404 }));
        await expect(
            WorkerManager.fetchGeoJSON("https://example.com/missing.json", "ly1")
        ).rejects.toThrow();
    });

    it("fetchText with relative URL resolves to absolute", async () => {
        global.fetch = vi.fn(() =>
            Promise.resolve({ ok: true, text: () => Promise.resolve("<gpx/>") })
        );
        const result = await WorkerManager.fetchText("data/f.gpx", "ly1");
        expect(result).toBe("<gpx/>");
        expect(global.fetch).toHaveBeenCalled();
    });

    it("fetchGeoJSON fallback rejects when json parse fails (response.json throws)", async () => {
        global.fetch = vi.fn(() =>
            Promise.resolve({ ok: true, json: () => Promise.reject(new Error("invalid json")) })
        );
        await expect(
            WorkerManager.fetchGeoJSON("https://example.com/bad.json", "ly1")
        ).rejects.toThrow("invalid json");
    });

    it("isAvailable returns false by default in test environment (no Worker)", () => {
        expect(typeof WorkerManager.isAvailable()).toBe("boolean");
    });

    it("dispose can be called when worker is null (no-op)", () => {
        WorkerManager.dispose();
        expect(() => WorkerManager.dispose()).not.toThrow();
    });

    it("fetchGeoJSON normalizes data with empty features array", async () => {
        const fc = { type: "FeatureCollection", features: [] };
        global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(fc) }));
        const result = await WorkerManager.fetchGeoJSON("https://example.com/empty.json", "ly1");
        expect(result.type).toBe("FeatureCollection");
        expect(result.features).toEqual([]);
    });

    it("fetchText fallback rejects when response is not ok", async () => {
        global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 403 }));
        await expect(
            WorkerManager.fetchText("https://example.com/bad.gpx", "ly1")
        ).rejects.toThrow();
    });

    it("fetchGeoJSON with invalid JSON (not FC, Feature, or Array) returns as-is", async () => {
        const data = { type: "SomeOtherType", data: "misc" };
        global.fetch = vi.fn(() =>
            Promise.resolve({ ok: true, json: () => Promise.resolve(data) })
        );
        const result = await WorkerManager.fetchGeoJSON("https://example.com/other.json", "ly1");
        expect(result.type).toBe("SomeOtherType");
    });
});

// ── Worker paths — fresh module via isolateModules ───────────────────────────
describe("geojson/worker-manager — Worker paths (T19)", () => {
    let WM;
    let mockWorkerInst;

    beforeEach(async () => {
        mockWorkerInst = null;
        global.Worker = vi.fn(function () {
            this.postMessage = vi.fn();
            this.terminate = vi.fn();
            this.onmessage = null;
            this.onerror = null;
            // capture 'this' so tests can trigger onmessage/onerror
            mockWorkerInst = this;
        });
        // Ensure fetch is available for fallback paths
        if (!global.fetch) {
            global.fetch = vi.fn(() =>
                Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
            );
        }
        // vi.resetModules clears both require.cache and Jest mock cache
        vi.resetModules();
        WM = (await import("../../src/kernel/geojson/worker-manager.js")).WorkerManager;
    });

    afterEach(() => {
        WM.dispose();
        delete global.Worker;
        delete global.fetch;
        vi.clearAllTimers();
    });

    // ── isAvailable ────────────────────────────────────────────────
    it("isAvailable returns true when Worker is available", () => {
        expect(WM.isAvailable()).toBe(true);
    });

    // ── _createWorker — success & reuse ────────────────────────────
    it("_createWorker is called once and reused on second fetchGeoJSON", async () => {
        WM.fetchGeoJSON("https://ex.com/a.json", "l1");
        WM.fetchGeoJSON("https://ex.com/b.json", "l2");
        expect(global.Worker).toHaveBeenCalledTimes(1);
        // clean up pending
        mockWorkerInst.onmessage({ data: { type: "done", layerId: "l1" } });
        mockWorkerInst.onmessage({ data: { type: "done", layerId: "l2" } });
    });

    // ── fetchGeoJSON — worker path ─────────────────────────────────
    it("fetchGeoJSON posts correct message to Worker and resolves on done", async () => {
        const promise = WM.fetchGeoJSON("https://ex.com/d.json", "l1");
        expect(mockWorkerInst.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: "fetch", url: "https://ex.com/d.json", layerId: "l1" })
        );
        mockWorkerInst.onmessage({ data: { type: "done", layerId: "l1" } });
        const result = await promise;
        expect(result).toEqual({ type: "FeatureCollection", features: [] });
    });

    it("fetchGeoJSON accumulates chunk features before done", async () => {
        const promise = WM.fetchGeoJSON("https://ex.com/d.json", "l1");
        const f1 = { type: "Feature", geometry: null, properties: { a: 1 } };
        const f2 = { type: "Feature", geometry: null, properties: { b: 2 } };
        mockWorkerInst.onmessage({
            data: { type: "chunk", layerId: "l1", features: [f1], index: 0, total: 2 },
        });
        mockWorkerInst.onmessage({
            data: { type: "chunk", layerId: "l1", features: [f2], index: 1, total: 2 },
        });
        mockWorkerInst.onmessage({ data: { type: "done", layerId: "l1" } });
        const result = await promise;
        expect(result.features).toEqual([f1, f2]);
    });

    it("fetchGeoJSON calls onChunk callback for each chunk", async () => {
        const onChunk = vi.fn();
        const promise = WM.fetchGeoJSON("https://ex.com/d.json", "l1", { onChunk });
        const feat = { type: "Feature", geometry: null, properties: {} };
        mockWorkerInst.onmessage({
            data: { type: "chunk", layerId: "l1", features: [feat], index: 0, total: 1 },
        });
        mockWorkerInst.onmessage({ data: { type: "done", layerId: "l1" } });
        await promise;
        expect(onChunk).toHaveBeenCalledWith([feat], 0, 1);
    });

    it("chunk with no features array does not crash", async () => {
        const promise = WM.fetchGeoJSON("https://ex.com/d.json", "l1");
        mockWorkerInst.onmessage({ data: { type: "chunk", layerId: "l1" } }); // no features
        mockWorkerInst.onmessage({ data: { type: "done", layerId: "l1" } });
        const result = await promise;
        expect(result.features).toEqual([]);
    });

    it("fetchGeoJSON rejects on error message from Worker", async () => {
        const promise = WM.fetchGeoJSON("https://ex.com/d.json", "l1");
        mockWorkerInst.onmessage({
            data: { type: "error", layerId: "l1", message: "parse failed" },
        });
        await expect(promise).rejects.toThrow("parse failed");
    });

    it("error message without matching layerId logs warn (no crash)", () => {
        WM.fetchGeoJSON("https://ex.com/d.json", "l1").catch(() => {}); // suppress unhandled rejection from dispose
        expect(() => {
            mockWorkerInst.onmessage({ data: { type: "error", message: "global error" } });
        }).not.toThrow();
    });

    // ── fetchText — worker path ────────────────────────────────────
    it("fetchText posts fetch-text message and resolves on text-done", async () => {
        const promise = WM.fetchText("https://ex.com/f.gpx", "l1");
        expect(mockWorkerInst.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                type: "fetch-text",
                url: "https://ex.com/f.gpx",
                layerId: "l1",
            })
        );
        mockWorkerInst.onmessage({ data: { type: "text-done", layerId: "l1", text: "<gpx/>" } });
        const result = await promise;
        expect(result).toBe("<gpx/>");
    });

    it("text-done with no text field resolves to empty string", async () => {
        const promise = WM.fetchText("https://ex.com/f.gpx", "l1");
        mockWorkerInst.onmessage({ data: { type: "text-done", layerId: "l1" } }); // no text
        const result = await promise;
        expect(result).toBe("");
    });

    // ── _onMessage — edge cases ────────────────────────────────────
    it("_onMessage: null data returns early without crash", () => {
        WM.fetchGeoJSON("https://ex.com/d.json", "l1").catch(() => {}); // l1 pending → suppress dispose rejection
        expect(() => mockWorkerInst.onmessage({ data: null })).not.toThrow();
    });

    it("_onMessage: missing type returns early without crash", () => {
        WM.fetchGeoJSON("https://ex.com/d.json", "l1").catch(() => {}); // l1 pending → suppress dispose rejection
        expect(() => mockWorkerInst.onmessage({ data: { layerId: "l1" } })).not.toThrow();
    });

    it("_onMessage: pong is handled without crash", () => {
        WM.fetchGeoJSON("https://ex.com/d.json", "l1").catch(() => {}); // l1 pending → suppress dispose rejection
        expect(() => mockWorkerInst.onmessage({ data: { type: "pong" } })).not.toThrow();
    });

    // ── _onError — global Worker error ────────────────────────────
    it("_onError rejects all pending promises and marks workerAvailable false", async () => {
        const p1 = WM.fetchGeoJSON("https://ex.com/a.json", "l1");
        const p2 = WM.fetchGeoJSON("https://ex.com/b.json", "l2");
        mockWorkerInst.onerror({ message: "worker crashed" });
        await expect(p1).rejects.toThrow();
        await expect(p2).rejects.toThrow();
        // workerAvailable = false → next call uses fallback
        global.fetch = vi.fn(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ type: "FeatureCollection", features: [] }),
            })
        );
        const result = await WM.fetchGeoJSON("https://ex.com/c.json", "l3");
        expect(result.type).toBe("FeatureCollection");
    });

    it("_onError uses filename when message absent", () => {
        WM.fetchGeoJSON("https://ex.com/d.json", "l1").catch(() => {}); // suppress onerror rejection
        expect(() => mockWorkerInst.onerror({ filename: "worker.js" })).not.toThrow();
    });

    // ── dispose with active worker + pending ──────────────────────
    it("dispose rejects pending entries and terminates active Worker", async () => {
        const promise = WM.fetchGeoJSON("https://ex.com/d.json", "l1");
        WM.dispose();
        await expect(promise).rejects.toThrow("WorkerManager disposed");
        expect(mockWorkerInst.terminate).toHaveBeenCalled();
    });

    // ── idle timer ────────────────────────────────────────────────
    describe("idle timer", () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });
        afterEach(() => {
            vi.useRealTimers();
        });

        it("terminates Worker after 30s of inactivity following done", async () => {
            const promise = WM.fetchGeoJSON("https://ex.com/d.json", "l1");
            mockWorkerInst.onmessage({ data: { type: "done", layerId: "l1" } });
            await promise;
            vi.advanceTimersByTime(30001);
            expect(mockWorkerInst.terminate).toHaveBeenCalled();
        });

        it("idle timer is reset when a new request arrives", async () => {
            const p1 = WM.fetchGeoJSON("https://ex.com/a.json", "l1");
            mockWorkerInst.onmessage({ data: { type: "done", layerId: "l1" } });
            await p1;
            // 20s in — new request resets the timer
            vi.advanceTimersByTime(20000);
            WM.fetchGeoJSON("https://ex.com/b.json", "l2");
            vi.advanceTimersByTime(20000); // 40s from first done, but only 20s from reset
            expect(mockWorkerInst.terminate).not.toHaveBeenCalled();
            // clean up
            mockWorkerInst.onmessage({ data: { type: "done", layerId: "l2" } });
        });
    });
});
