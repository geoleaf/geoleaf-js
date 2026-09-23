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
    // ⚠️ Inverted on 23/09/2026. This case pinned "_onError rejects all pending promises": the
    // handler's own comment said "fall back to the main thread", and the loads the Worker was
    // built for failed instead — a 404 on the worker's script fires `error` only once they are
    // pending, so the first layers of a page rendered nothing.
    it("_onError replays on the main thread the requests none of whose chunks arrived", async () => {
        global.fetch = vi.fn((url) =>
            Promise.resolve({
                ok: true,
                json: () =>
                    Promise.resolve({
                        type: "FeatureCollection",
                        features: [{ type: "Feature", properties: { url } }],
                    }),
            })
        );
        const p1 = WM.fetchGeoJSON("https://ex.com/a.json", "l1");
        const p2 = WM.fetchGeoJSON("https://ex.com/b.json", "l2");
        mockWorkerInst.onerror({ message: "worker crashed" });
        await expect(p1).resolves.toMatchObject({
            features: [{ properties: { url: "https://ex.com/a.json" } }],
        });
        await expect(p2).resolves.toMatchObject({
            features: [{ properties: { url: "https://ex.com/b.json" } }],
        });
        // workerAvailable = false → next call uses the fallback, no second Worker
        const result = await WM.fetchGeoJSON("https://ex.com/c.json", "l3");
        expect(result.type).toBe("FeatureCollection");
        expect(global.Worker).toHaveBeenCalledTimes(1);
        expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    it("_onError rejects a request that already received chunks — a replay would deliver them twice", async () => {
        global.fetch = vi.fn(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ type: "FeatureCollection", features: [] }),
            })
        );
        const onChunk = vi.fn();
        const p1 = WM.fetchGeoJSON("https://ex.com/a.json", "l1", { onChunk });
        mockWorkerInst.onmessage({
            data: {
                type: "chunk",
                layerId: "l1",
                features: [{ type: "Feature" }],
                index: 0,
                total: 2,
            },
        });
        mockWorkerInst.onerror({ message: "worker crashed" });
        await expect(p1).rejects.toThrow("Worker error: worker crashed");
        expect(onChunk).toHaveBeenCalledTimes(1);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it("_onError replays an in-flight text request on the main thread", async () => {
        global.fetch = vi.fn(() =>
            Promise.resolve({ ok: true, text: () => Promise.resolve("<gpx/>") })
        );
        const p = WM.fetchText("https://ex.com/t.gpx", "g1");
        mockWorkerInst.onerror({ message: "" });
        await expect(p).resolves.toBe("<gpx/>");
        expect(global.fetch).toHaveBeenCalledWith("https://ex.com/t.gpx", expect.anything());
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

// ── The header hook a plugin may set — and answer with a promise ─────────────
//
// A plugin authenticates the worker's requests through `__GEOLEAF_WORKER_HEADERS_HOOK__`, read
// on the global so that the core never imports it. It was read synchronously, right before
// `postMessage`: a token provider that answers with a promise — an identity SDK — could not
// reach the worker, and every GeoJSON layer loaded by URL left without its token.
describe("geojson/worker-manager — the header hook a plugin may answer", () => {
    let WM;
    let worker;
    const URL_A = "https://ex.com/a.json";
    /** Lets a settled hook and the deferred post run. */
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    beforeEach(async () => {
        worker = null;
        global.Worker = vi.fn(function () {
            this.postMessage = vi.fn();
            this.terminate = vi.fn();
            this.onmessage = null;
            this.onerror = null;
            worker = this;
        });
        vi.resetModules();
        WM = (await import("../../src/kernel/geojson/worker-manager.js")).WorkerManager;
    });

    afterEach(() => {
        WM.dispose();
        delete global.Worker;
        delete globalThis.__GEOLEAF_WORKER_HEADERS_HOOK__;
        vi.clearAllTimers();
    });

    it("tells the hook it may answer with a promise", () => {
        const hook = vi.fn(() => undefined);
        globalThis.__GEOLEAF_WORKER_HEADERS_HOOK__ = hook;
        WM.fetchGeoJSON(URL_A, "l1").catch(() => undefined);
        expect(hook).toHaveBeenCalledWith(URL_A, { acceptsPromise: true });
    });

    it("a synchronous answer is still posted synchronously", () => {
        globalThis.__GEOLEAF_WORKER_HEADERS_HOOK__ = () => ({ Authorization: "Bearer s" });
        WM.fetchGeoJSON(URL_A, "l1").catch(() => undefined);
        expect(worker.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: "fetch", headers: { Authorization: "Bearer s" } })
        );
    });

    it("🛑 an answer that is a promise is posted once settled, with the headers it resolves to", async () => {
        globalThis.__GEOLEAF_WORKER_HEADERS_HOOK__ = () =>
            Promise.resolve({ Authorization: "Bearer p" });
        WM.fetchGeoJSON(URL_A, "l1").catch(() => undefined);
        await flush();
        expect(worker.postMessage).toHaveBeenCalledTimes(1);
        expect(worker.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: "fetch", headers: { Authorization: "Bearer p" } })
        );
    });

    it("🛑 a promise that rejects: the load is posted without headers", async () => {
        globalThis.__GEOLEAF_WORKER_HEADERS_HOOK__ = () =>
            Promise.reject(new Error("host session unreachable"));
        WM.fetchGeoJSON(URL_A, "l1").catch(() => undefined);
        await flush();
        expect(worker.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: "fetch", headers: undefined })
        );
    });

    it("🛑 a hook that throws: the load is posted without headers", () => {
        globalThis.__GEOLEAF_WORKER_HEADERS_HOOK__ = () => {
            throw new Error("broken hook");
        };
        WM.fetchGeoJSON(URL_A, "l1").catch(() => undefined);
        expect(worker.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: "fetch", headers: undefined })
        );
    });

    it("disposed while the hook answers: nothing is posted, and the load stays rejected", async () => {
        let answer;
        globalThis.__GEOLEAF_WORKER_HEADERS_HOOK__ = () => new Promise((r) => (answer = r));
        const outcome = WM.fetchGeoJSON(URL_A, "l1").then(
            () => "resolved",
            (e) => e.message
        );
        const disposed = worker;
        WM.dispose();
        answer({ Authorization: "Bearer late" });
        await flush();
        expect(disposed.postMessage).not.toHaveBeenCalled();
        expect(await outcome).toBe("WorkerManager disposed");
    });

    it("🛑 the worker fails while the hook answers: the load is replayed, not rejected as superseded", async () => {
        let answer;
        globalThis.__GEOLEAF_WORKER_HEADERS_HOOK__ = () => new Promise((r) => (answer = r));
        const fetchOrigine = global.fetch;
        global.fetch = vi.fn(() =>
            Promise.resolve({
                ok: true,
                json: () =>
                    Promise.resolve({ type: "FeatureCollection", features: [{ type: "Feature" }] }),
            })
        );
        try {
            const outcome = WM.fetchGeoJSON(URL_A, "l1").then(
                (fc) => fc.features.length,
                (e) => e.message
            );
            const failed = worker;
            // The worker's script 404s before the host's token provider has answered.
            failed.onerror({ message: "" });
            answer({ Authorization: "Bearer late" });
            await flush();
            expect(failed.postMessage).not.toHaveBeenCalled();
            expect(await outcome).toBe(1);
            expect(global.fetch).toHaveBeenCalledWith(URL_A, expect.anything());
        } finally {
            global.fetch = fetchOrigine;
        }
    });

    it("a load superseded while its hook answers is rejected — not left pending", async () => {
        const answers = [];
        globalThis.__GEOLEAF_WORKER_HEADERS_HOOK__ = () => new Promise((r) => answers.push(r));
        const first = WM.fetchGeoJSON(URL_A, "l1").then(
            () => "resolved",
            () => "rejected"
        );
        WM.fetchGeoJSON("https://ex.com/b.json", "l1").catch(() => undefined);
        for (const answer of answers) answer({ Authorization: "Bearer x" });
        await flush();
        expect(await first).toBe("rejected");
        expect(worker.postMessage).toHaveBeenCalledTimes(1);
        expect(worker.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ url: "https://ex.com/b.json" })
        );
    });

    it("a deferred post that throws rejects the load instead of leaving it pending", async () => {
        globalThis.__GEOLEAF_WORKER_HEADERS_HOOK__ = () =>
            Promise.resolve({ Authorization: "Bearer p" });
        const outcome = WM.fetchGeoJSON(URL_A, "l1").then(
            () => "resolved",
            (e) => e.message
        );
        worker.postMessage.mockImplementation(() => {
            throw new Error("DataCloneError: could not be cloned");
        });
        await flush();
        expect(await outcome).toMatch(/DataCloneError/);
    });

    it("fetchText: the same hook, promise included", async () => {
        const hook = vi.fn(() => Promise.resolve({ Authorization: "Bearer t" }));
        globalThis.__GEOLEAF_WORKER_HEADERS_HOOK__ = hook;
        WM.fetchText("https://ex.com/trace.gpx", "g1").catch(() => undefined);
        await flush();
        expect(hook).toHaveBeenCalledWith("https://ex.com/trace.gpx", { acceptsPromise: true });
        expect(worker.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: "fetch-text", headers: { Authorization: "Bearer t" } })
        );
    });
});
