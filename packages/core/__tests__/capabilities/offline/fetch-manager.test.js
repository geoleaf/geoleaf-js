/**
 * Unit tests — FetchManager
 * Covers: fetch, _parseResponse, _parseTile, _parseText, _parseJSON,
 *         fetchAll, _worker, isModified, _extractMetadata
 */

/** Build a mock fetch Response object */
function makeMockResponse({
    ok = true,
    status = 200,
    statusText = "OK",
    headers = {},
    body = "",
} = {}) {
    const headerMap = new Map(Object.entries(headers));
    const textBody = typeof body === "string" ? body : JSON.stringify(body);
    // Build a simple ArrayBuffer without TextEncoder (not always available in jsdom)
    const makeArrayBuffer = (str) => {
        const buf = new ArrayBuffer(str.length);
        const view = new Uint8Array(buf);
        for (let i = 0; i < str.length; i++) view[i] = str.charCodeAt(i) & 0xff;
        return buf;
    };
    return {
        ok,
        status,
        statusText,
        headers: { get: (key) => headerMap.get(key) ?? null },
        text: () => Promise.resolve(textBody),
        json: () => Promise.resolve(typeof body === "object" ? body : JSON.parse(textBody)),
        blob: () =>
            Promise.resolve({
                size: textBody.length,
                type: headers["content-type"] || headers["Content-Type"] || "",
                arrayBuffer: () => Promise.resolve(makeArrayBuffer(textBody)),
            }),
    };
}

import { FetchManager } from "../../../src/capabilities/offline/cache/fetch-manager.js";

describe("FetchManager", () => {
    let fetchSpy;
    let originalFetch;

    beforeEach(() => {
        originalFetch = global.fetch;
        fetchSpy = vi.fn();
        global.fetch = fetchSpy;
    });

    afterEach(() => {
        global.fetch = originalFetch;
        vi.useRealTimers();
    });

    // ----- fetch() -----

    describe("fetch()", () => {
        test("returns FetchResult with data, size, metadata on success (json type)", async () => {
            const jsonBody = { features: [] };
            fetchSpy.mockResolvedValueOnce(
                makeMockResponse({
                    body: jsonBody,
                    headers: { "Content-Type": "application/json" },
                })
            );

            const result = await FetchManager.fetch({
                url: "https://a.com/data.json",
                type: "config",
            });
            expect(result).toHaveProperty("data");
            expect(result).toHaveProperty("size");
            expect(result).toHaveProperty("metadata");
            expect(result.data).toEqual(jsonBody);
        });

        test("throws when response is not ok (non-optional)", async () => {
            fetchSpy.mockResolvedValueOnce(
                makeMockResponse({ ok: false, status: 500, statusText: "Server Error" })
            );
            await expect(
                FetchManager.fetch({ url: "https://a.com/data.json", type: "config" })
            ).rejects.toThrow("HTTP 500");
        });

        test("skips gracefully when optional resource returns 404", async () => {
            fetchSpy.mockResolvedValueOnce(
                makeMockResponse({ ok: false, status: 404, statusText: "Not Found" })
            );
            const result = await FetchManager.fetch({
                url: "https://a.com/missing.json",
                type: "config",
                optional: true,
            });
            expect(result.skipped).toBe(true);
            expect(result.data).toBeNull();
            expect(result.metadata).toMatchObject({ status: 404, optional: true });
        });

        test("throws when non-optional resource returns 404", async () => {
            fetchSpy.mockResolvedValueOnce(
                makeMockResponse({ ok: false, status: 404, statusText: "Not Found" })
            );
            await expect(
                FetchManager.fetch({ url: "https://a.com/missing.json", type: "config" })
            ).rejects.toThrow("HTTP 404");
        });

        test("passes signal to global fetch", async () => {
            fetchSpy.mockResolvedValueOnce(
                makeMockResponse({
                    body: '{"ok":true}',
                    headers: { "Content-Type": "application/json" },
                })
            );
            const controller = new AbortController();
            await FetchManager.fetch(
                { url: "https://a.com/data.json", type: "config" },
                { signal: controller.signal }
            );
            // ⚠️ Ce n'est PLUS le signal de l'appelant qui atteint `fetch` (tâche 3.8) : la
            // requête est bornée, donc `fetchBounded` passe le sien et CHAÎNE celui-ci
            // dessus. L'annulation de l'appelant reste effective — c'est ce qui est vérifié
            // juste après — mais asserter l'IDENTITÉ de l'objet reviendrait à interdire le
            // bornage. On assert qu'un signal est passé, puis que l'annulation propage.
            expect(fetchSpy).toHaveBeenCalledWith(
                "https://a.com/data.json",
                expect.objectContaining({ signal: expect.any(AbortSignal) })
            );
            // ⚠️ On n'assert PAS ici que `controller.abort()` propage après coup : la requête
            // est déjà terminée, et `fetchBounded` a retiré son écouteur dans son `finally`.
            // Exiger la propagation post-mortem reviendrait à exiger une FUITE d'écouteur —
            // exactement ce que le `finally` existe pour éviter. Le chaînage est éprouvé,
            // pendant la requête, par `__tests__/utils/fetch-bounded.test.js`.
            expect(fetchSpy.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
        });
    });

    // ----- _extractMetadata() -----

    describe("_extractMetadata()", () => {
        test("extracts standard headers into metadata object", () => {
            const resp = makeMockResponse({
                headers: {
                    ETag: '"abc123"',
                    "Last-Modified": "Mon, 01 Jan 2024 00:00:00 GMT",
                    "Content-Type": "application/json",
                    "Content-Length": "256",
                    "Cache-Control": "max-age=3600",
                },
            });
            const meta = FetchManager._extractMetadata(resp);
            expect(meta.etag).toBe('"abc123"');
            expect(meta.lastModified).toBe("Mon, 01 Jan 2024 00:00:00 GMT");
            expect(meta.contentType).toBe("application/json");
            expect(meta.contentLength).toBe("256");
            expect(meta.cacheControl).toBe("max-age=3600");
            expect(typeof meta.fetchedAt).toBe("number");
        });

        test("returns null for missing headers", () => {
            const resp = makeMockResponse({});
            const meta = FetchManager._extractMetadata(resp);
            expect(meta.etag).toBeNull();
            expect(meta.lastModified).toBeNull();
        });
    });

    // ----- _parseResponse() -----

    describe("_parseResponse() — routing by type", () => {
        test("routes type=tile to _parseTile (returns binary kind)", async () => {
            const resp = makeMockResponse({ body: "binary-data" });
            const { data } = await FetchManager._parseResponse(resp, {
                url: "a/b.png",
                type: "tile",
            });
            expect(data).toHaveProperty("kind", "binary");
            expect(data).toHaveProperty("buffer");
        });

        test("routes type=icon to _parseText", async () => {
            const svgBody = "<svg></svg>";
            const resp = makeMockResponse({ body: svgBody });
            const { data } = await FetchManager._parseResponse(resp, {
                url: "a/icon.png",
                type: "icon",
            });
            expect(data).toBe(svgBody);
        });

        test("routes .svg URL to _parseText via content-type", async () => {
            const svgBody = "<svg><circle/></svg>";
            const resp = makeMockResponse({
                body: svgBody,
                headers: { "Content-Type": "image/svg+xml" },
            });
            const { data } = await FetchManager._parseResponse(resp, {
                url: "a/icon",
                type: "other",
            });
            expect(data).toBe(svgBody);
        });

        test("routes .svg URL extension to _parseText", async () => {
            const svgBody = "<svg/>";
            const resp = makeMockResponse({ body: svgBody });
            const { data } = await FetchManager._parseResponse(resp, {
                url: "a/x.svg",
                type: "other",
            });
            expect(data).toBe(svgBody);
        });

        test("routes .gpx extension to _parseText", async () => {
            const gpxBody = "<gpx></gpx>";
            const resp = makeMockResponse({ body: gpxBody });
            const { data } = await FetchManager._parseResponse(resp, {
                url: "track.gpx",
                type: "other",
            });
            expect(data).toBe(gpxBody);
        });

        test("routes XML content-type to _parseText", async () => {
            const xmlBody = "<root/>";
            const resp = makeMockResponse({
                body: xmlBody,
                headers: { "content-type": "application/xml" },
            });
            const { data } = await FetchManager._parseResponse(resp, {
                url: "data.xml",
                type: "other",
            });
            expect(data).toBe(xmlBody);
        });

        test("routes .json URL to _parseJSON", async () => {
            const jsonBody = { a: 1 };
            const resp = makeMockResponse({ body: jsonBody });
            const { data } = await FetchManager._parseResponse(resp, {
                url: "data.json",
                type: "other",
            });
            expect(data).toEqual(jsonBody);
        });

        test("routes .geojson URL to _parseJSON", async () => {
            const geojson = { type: "FeatureCollection", features: [] };
            const resp = makeMockResponse({ body: geojson });
            const { data } = await FetchManager._parseResponse(resp, {
                url: "map.geojson",
                type: "other",
            });
            expect(data).toEqual(geojson);
        });

        test("routes json content-type to _parseJSON", async () => {
            const jsonBody = { x: 2 };
            const resp = makeMockResponse({
                body: jsonBody,
                headers: { "content-type": "application/json" },
            });
            const { data } = await FetchManager._parseResponse(resp, {
                url: "endpoint",
                type: "config",
            });
            expect(data).toEqual(jsonBody);
        });

        test("falls back to _parseText for unknown type", async () => {
            const textBody = "plain text content";
            const resp = makeMockResponse({ body: textBody });
            const { data } = await FetchManager._parseResponse(resp, {
                url: "data.bin",
                type: "unknown",
            });
            expect(data).toBe(textBody);
        });
    });

    // ----- fetchAll() -----

    describe("fetchAll()", () => {
        test("fetches all resources and returns results array", async () => {
            fetchSpy.mockResolvedValue(
                makeMockResponse({
                    body: '{"ok":true}',
                    headers: { "content-type": "application/json" },
                })
            );
            const resources = [
                { url: "https://a.com/1.json", type: "config" },
                { url: "https://a.com/2.json", type: "config" },
            ];
            const results = await FetchManager.fetchAll(resources);
            expect(results).toHaveLength(2);
            expect(results[0]).toHaveProperty("resource");
            expect(results[0]).toHaveProperty("result");
        });

        test("records error in results when fetch fails", async () => {
            fetchSpy.mockRejectedValueOnce(new Error("network error"));
            fetchSpy.mockResolvedValueOnce(
                makeMockResponse({
                    body: '{"ok":true}',
                    headers: { "content-type": "application/json" },
                })
            );
            const resources = [
                { url: "https://a.com/bad.json", type: "config" },
                { url: "https://a.com/good.json", type: "config" },
            ];
            const results = await FetchManager.fetchAll(resources, { concurrency: 1 });
            const failed = results.find((r) => r.error);
            const ok = results.find((r) => r.result);
            expect(failed).toBeDefined();
            expect(ok).toBeDefined();
        });

        test("calls onResource callback for each resource", async () => {
            fetchSpy.mockResolvedValue(
                makeMockResponse({ body: "text", headers: { "content-type": "text/plain" } })
            );
            const resources = [{ url: "https://a.com/a.txt", type: "config" }];
            const onResource = vi.fn();
            await FetchManager.fetchAll(resources, { concurrency: 1, onResource });
            expect(onResource).toHaveBeenCalledTimes(1);
            const [calledResource, calledResult, calledError] = onResource.mock.calls[0];
            expect(calledResource.url).toBe("https://a.com/a.txt");
            expect(calledResult).not.toBeNull();
            expect(calledError).toBeNull();
        });

        test("onResource callback error is swallowed (not thrown)", async () => {
            fetchSpy.mockResolvedValue(makeMockResponse({ body: "data" }));
            const resources = [{ url: "https://a.com/x.txt", type: "config" }];
            const throwingCb = () => {
                throw new Error("callback fail");
            };
            await expect(
                FetchManager.fetchAll(resources, { concurrency: 1, onResource: throwingCb })
            ).resolves.toBeDefined();
        });

        test("stops workers early when signal is aborted", async () => {
            fetchSpy.mockResolvedValue(
                makeMockResponse({
                    body: '{"a":1}',
                    headers: { "content-type": "application/json" },
                })
            );
            const controller = new AbortController();
            controller.abort();
            const resources = [
                { url: "https://a.com/1.json", type: "config" },
                { url: "https://a.com/2.json", type: "config" },
            ];
            // Aborted before any work — workers should exit early
            const results = await FetchManager.fetchAll(resources, { signal: controller.signal });
            // Results may be empty or partial
            expect(Array.isArray(results)).toBe(true);
        });

        test("returns empty array for empty resources", async () => {
            const results = await FetchManager.fetchAll([]);
            expect(results).toEqual([]);
        });

        test("uses default concurrency=10 when not specified", async () => {
            fetchSpy.mockResolvedValue(
                makeMockResponse({
                    body: '{"ok":1}',
                    headers: { "content-type": "application/json" },
                })
            );
            const resources = Array.from({ length: 5 }, (_, i) => ({
                url: `https://a.com/${i}.json`,
                type: "config",
            }));
            const results = await FetchManager.fetchAll(resources);
            expect(results).toHaveLength(5);
        });
    });

    // ----- isModified() -----

    describe("isModified()", () => {
        test("returns false (not modified) when ETag matches", async () => {
            fetchSpy.mockResolvedValueOnce(makeMockResponse({ headers: { ETag: '"abc"' } }));
            const isModified = await FetchManager.isModified("https://a.com/data.json", {
                etag: '"abc"',
            });
            expect(isModified).toBe(false);
        });

        test("returns true when ETag has changed", async () => {
            fetchSpy.mockResolvedValueOnce(makeMockResponse({ headers: { ETag: '"xyz"' } }));
            const isModified = await FetchManager.isModified("https://a.com/data.json", {
                etag: '"abc"',
            });
            expect(isModified).toBe(true);
        });

        test("returns false when Last-Modified matches", async () => {
            const lm = "Mon, 01 Jan 2024 00:00:00 GMT";
            fetchSpy.mockResolvedValueOnce(makeMockResponse({ headers: { "Last-Modified": lm } }));
            const isModified = await FetchManager.isModified("https://a.com/data.json", {
                lastModified: lm,
            });
            expect(isModified).toBe(false);
        });

        test("returns true when Last-Modified differs", async () => {
            fetchSpy.mockResolvedValueOnce(
                makeMockResponse({ headers: { "Last-Modified": "Tue, 02 Jan 2024 00:00:00 GMT" } })
            );
            const isModified = await FetchManager.isModified("https://a.com/data.json", {
                lastModified: "Mon, 01 Jan 2024 00:00:00 GMT",
            });
            expect(isModified).toBe(true);
        });

        test("returns true (assume modified) when HEAD returns non-OK", async () => {
            fetchSpy.mockResolvedValueOnce(makeMockResponse({ ok: false, status: 503 }));
            const isModified = await FetchManager.isModified("https://a.com/data.json", {});
            expect(isModified).toBe(true);
        });

        test("returns true (assume modified) when no etag and no last-modified", async () => {
            fetchSpy.mockResolvedValueOnce(makeMockResponse({}));
            const isModified = await FetchManager.isModified("https://a.com/data.json", {});
            expect(isModified).toBe(true);
        });

        test("returns false (keep cached) when fetch throws", async () => {
            fetchSpy.mockRejectedValueOnce(new Error("network error"));
            const isModified = await FetchManager.isModified("https://a.com/data.json", {});
            expect(isModified).toBe(false);
        });

        test("uses options.signal for HEAD request", async () => {
            fetchSpy.mockResolvedValueOnce(makeMockResponse({ headers: { ETag: '"v1"' } }));
            const controller = new AbortController();
            await FetchManager.isModified(
                "https://a.com/data.json",
                { etag: '"v1"' },
                {
                    signal: controller.signal,
                }
            );
            // Même raison qu'au-dessus : le signal passé est celui de l'échéance, sur lequel
            // celui de l'appelant est chaîné.
            expect(fetchSpy).toHaveBeenCalledWith(
                "https://a.com/data.json",
                expect.objectContaining({ method: "HEAD", signal: expect.any(AbortSignal) })
            );
            expect(fetchSpy.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
        });

        test("isModified() with no options uses default {} (default param branch)", async () => {
            fetchSpy.mockResolvedValueOnce(makeMockResponse({ headers: { ETag: '"v2"' } }));
            // Call without 3rd argument → takes default options = {}
            const result = await FetchManager.isModified("https://a.com/x.json", { etag: '"v2"' });
            expect(result).toBe(false);
        });
    });

    // ----- _parseTile() -----

    describe("_parseTile()", () => {
        test("returns binary kind with buffer and mimeType from blob.type", async () => {
            const resp = makeMockResponse({
                body: "PNG-DATA",
                headers: { "content-type": "image/png" },
            });
            const { data, size } = await FetchManager._parseTile(resp);
            expect(data.kind).toBe("binary");
            expect(data.buffer).toBeInstanceOf(ArrayBuffer);
            expect(typeof data.mimeType).toBe("string");
            expect(size).toBeGreaterThanOrEqual(0);
        });
    });

    // ----- fetchAll() with fetch() params default {} (line 48 default param) -----

    describe("fetch() with default options (line 48 default branch)", () => {
        test("fetch() without second arg uses default options = {}", async () => {
            fetchSpy.mockResolvedValueOnce(
                makeMockResponse({
                    body: '{"x":1}',
                    headers: { "content-type": "application/json" },
                })
            );
            // Call without options argument → default options = {}
            const result = await FetchManager.fetch({
                url: "https://a.com/x.json",
                type: "config",
            });
            expect(result.data).toEqual({ x: 1 });
        });
    });
});
