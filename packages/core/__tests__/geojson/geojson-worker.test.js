/**
 * R2 — Tests du worker GeoJSON (geojson-worker.ts).
 * Mock du contexte Worker (self.postMessage, self.onmessage) et de fetch.
 */

function flushPromises() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("geojson-worker (R2)", () => {
    let postMessageFn;
    let fetchFn;

    beforeAll(async () => {
        postMessageFn = vi.fn();
        fetchFn = vi.fn();
        // jsdom already provides self/window; we replace postMessage/onmessage for the worker
        if (typeof global.self === "undefined") {
            global.self = { postMessage: postMessageFn, onmessage: null };
        } else {
            global.self.postMessage = postMessageFn;
            global.self.onmessage = null;
        }
        global.fetch = fetchFn;
        // ⚠️ The deferral is LOAD-BEARING and must not become a top-level import:
        // `geojson-worker.ts` assigns `self.onmessage` at module scope, so it has to run
        // AFTER the stubs above are installed. `await import()` keeps that order while
        // moving the load onto the ESM branch — the only branch coverage measures right.
        await import("../../src/kernel/geojson/geojson-worker.js");
    });

    afterAll(() => {
        if (global.self && global.self.postMessage === postMessageFn) {
            delete global.self.postMessage;
            delete global.self.onmessage;
        }
        if (global.fetch === fetchFn) delete global.fetch;
    });

    beforeEach(() => {
        postMessageFn.mockClear();
        fetchFn.mockClear();
    });

    describe("ping / pong", () => {
        it("responds pong to a ping message", () => {
            self.onmessage({ data: { type: "ping" } });
            expect(postMessageFn).toHaveBeenCalledTimes(1);
            expect(postMessageFn).toHaveBeenCalledWith({ type: "pong" });
        });
    });

    describe("message sans type", () => {
        it("ne fait rien si event.data est vide", () => {
            self.onmessage({ data: {} });
            expect(postMessageFn).not.toHaveBeenCalled();
        });
        it("ne fait rien si event.data est null", () => {
            self.onmessage({ data: null });
            expect(postMessageFn).not.toHaveBeenCalled();
        });
    });

    describe("type inconnu", () => {
        it("envoie error pour un type de message inconnu", () => {
            self.onmessage({ data: { type: "unknown", layerId: "L1" } });
            expect(postMessageFn).toHaveBeenCalledWith({
                type: "error",
                layerId: "L1",
                message: "Type de message inconnu : unknown",
            });
        });
    });

    describe("fetch (validateWorkerUrl + handleFetch)", () => {
        it("envoie error pour URL protocole interdit (javascript:)", async () => {
            const badUrl = "javascript:alert(1)";
            self.onmessage({
                data: { type: "fetch", url: badUrl, layerId: "l1" },
            });
            await flushPromises();
            await flushPromises();
            expect(postMessageFn).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: "error",
                    layerId: "l1",
                    message: expect.any(String),
                })
            );
            expect(postMessageFn.mock.calls[0][0].message.length).toBeGreaterThan(0);
        });

        it("envoie error pour URL vide", async () => {
            self.onmessage({ data: { type: "fetch", url: "", layerId: "l1" } });
            await flushPromises();
            await flushPromises();
            expect(postMessageFn).toHaveBeenCalledWith(
                expect.objectContaining({ type: "error", layerId: "l1" })
            );
        });

        it("accepte URL relative et appelle fetch", async () => {
            fetchFn.mockResolvedValue({
                ok: true,
                json: () =>
                    Promise.resolve({
                        type: "FeatureCollection",
                        features: [{ type: "Feature", id: "f1" }],
                    }),
            });
            self.onmessage({
                data: { type: "fetch", url: "profiles/data.json", layerId: "l1" },
            });
            await flushPromises();
            await flushPromises();
            await flushPromises();
            expect(fetchFn).toHaveBeenCalledWith("profiles/data.json", undefined);
            expect(postMessageFn).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: "chunk",
                    layerId: "l1",
                    features: [{ type: "Feature", id: "f1" }],
                })
            );
            expect(postMessageFn).toHaveBeenCalledWith(
                expect.objectContaining({ type: "done", layerId: "l1", featureCount: 1 })
            );
        });

        it("envoie chunk + done pour FeatureCollection", async () => {
            fetchFn.mockResolvedValue({
                ok: true,
                json: () =>
                    Promise.resolve({
                        type: "FeatureCollection",
                        features: [
                            { type: "Feature", id: "a" },
                            { type: "Feature", id: "b" },
                        ],
                    }),
            });
            self.onmessage({
                data: {
                    type: "fetch",
                    url: "https://example.com/geojson.json",
                    layerId: "ly",
                    chunkSize: 1,
                },
            });
            await flushPromises();
            await flushPromises();
            await flushPromises();
            expect(postMessageFn).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: "chunk",
                    layerId: "ly",
                    features: [{ type: "Feature", id: "a" }],
                    index: 0,
                    total: 2,
                })
            );
            expect(postMessageFn).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: "chunk",
                    layerId: "ly",
                    features: [{ type: "Feature", id: "b" }],
                    index: 1,
                    total: 2,
                })
            );
            expect(postMessageFn).toHaveBeenCalledWith(
                expect.objectContaining({ type: "done", featureCount: 2 })
            );
        });

        it("envoie error si response.ok est false", async () => {
            fetchFn.mockResolvedValue({ ok: false, status: 404 });
            self.onmessage({
                data: {
                    type: "fetch",
                    url: "https://example.com/missing.json",
                    layerId: "l1",
                },
            });
            await flushPromises();
            await flushPromises();
            await flushPromises();
            expect(postMessageFn).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: "error",
                    layerId: "l1",
                    message: expect.stringContaining("HTTP 404"),
                })
            );
        });

        it("accepte un seul Feature (pas FeatureCollection)", async () => {
            fetchFn.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ type: "Feature", geometry: {}, properties: {} }),
            });
            self.onmessage({
                data: {
                    type: "fetch",
                    url: "https://example.com/one.json",
                    layerId: "l1",
                },
            });
            await flushPromises();
            await flushPromises();
            await flushPromises();
            expect(postMessageFn).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: "chunk",
                    features: [{ type: "Feature", geometry: {}, properties: {} }],
                })
            );
            expect(postMessageFn).toHaveBeenCalledWith(
                expect.objectContaining({ type: "done", featureCount: 1 })
            );
        });
    });

    describe("fetch-text", () => {
        it("envoie text-done avec le corps texte", async () => {
            fetchFn.mockResolvedValue({
                ok: true,
                text: () => Promise.resolve("<gpx>...</gpx>"),
            });
            self.onmessage({
                data: {
                    type: "fetch-text",
                    url: "https://example.com/track.gpx",
                    layerId: "gpx1",
                },
            });
            await flushPromises();
            await flushPromises();
            await flushPromises();
            expect(postMessageFn).toHaveBeenCalledWith({
                type: "text-done",
                layerId: "gpx1",
                text: "<gpx>...</gpx>",
            });
        });

        it("envoie error pour protocole interdit sur fetch-text", async () => {
            self.onmessage({
                data: {
                    type: "fetch-text",
                    url: "file:///local/data.gpx",
                    layerId: "l1",
                },
            });
            await flushPromises();
            await flushPromises();
            expect(postMessageFn).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: "error",
                    message: expect.stringMatching(/not allowed|Protocol/),
                })
            );
        });

        it("T9.3.2 — transmet les headers de requête fetch-text (branche msg.headers truthy)", async () => {
            fetchFn.mockResolvedValue({
                ok: true,
                text: () => Promise.resolve("<gpx/>"),
            });
            self.onmessage({
                data: {
                    type: "fetch-text",
                    url: "https://example.com/track.gpx",
                    layerId: "gpx1",
                    headers: { Authorization: "Bearer test-token" },
                },
            });
            await flushPromises();
            await flushPromises();
            await flushPromises();
            expect(fetchFn).toHaveBeenCalledWith(
                "https://example.com/track.gpx",
                expect.objectContaining({ headers: { Authorization: "Bearer test-token" } })
            );
            expect(postMessageFn).toHaveBeenCalledWith(
                expect.objectContaining({ type: "text-done", layerId: "gpx1" })
            );
        });
    });

    // ── T9.3.2 — branches additionnelles ──────────────────────────────────────
    describe("T9.3.2 — branches _normalizeFeatures + handleFetch headers", () => {
        it("_normalizeFeatures — FeatureCollection avec features non-array (branche && false)", async () => {
            // data.type === 'FeatureCollection' BUT Array.isArray(null) === false
            // → tombe sur data?.features ?? []
            fetchFn.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ type: "FeatureCollection", features: null }),
            });
            self.onmessage({
                data: { type: "fetch", url: "https://example.com/fc.json", layerId: "l1" },
            });
            await flushPromises();
            await flushPromises();
            await flushPromises();
            // features: null ?? [] → featureCount should be 0
            expect(postMessageFn).toHaveBeenCalledWith(
                expect.objectContaining({ type: "done", layerId: "l1", featureCount: 0 })
            );
        });

        it("_normalizeFeatures — objet avec features array mais sans type (branche ?? left truthy)", async () => {
            // not FC, not Feature, not Array → hits data?.features ?? []
            // features is a real array → ?? uses the left side
            const feats = [{ type: "Feature", id: "x" }];
            fetchFn.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ custom: "data", features: feats }),
            });
            self.onmessage({
                data: { type: "fetch", url: "https://example.com/custom.json", layerId: "l2" },
            });
            await flushPromises();
            await flushPromises();
            await flushPromises();
            expect(postMessageFn).toHaveBeenCalledWith(
                expect.objectContaining({ type: "done", layerId: "l2", featureCount: 1 })
            );
        });

        it("handleFetch — transmet les headers de requête (branche msg.headers truthy)", async () => {
            fetchFn.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ type: "FeatureCollection", features: [] }),
            });
            self.onmessage({
                data: {
                    type: "fetch",
                    url: "https://example.com/data.json",
                    layerId: "l3",
                    headers: { Authorization: "Bearer secret" },
                },
            });
            await flushPromises();
            await flushPromises();
            await flushPromises();
            expect(fetchFn).toHaveBeenCalledWith(
                "https://example.com/data.json",
                expect.objectContaining({ headers: { Authorization: "Bearer secret" } })
            );
            expect(postMessageFn).toHaveBeenCalledWith(
                expect.objectContaining({ type: "done", layerId: "l3" })
            );
        });
    });
});
