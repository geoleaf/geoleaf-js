/**
 * @file config-loader.test.js
 * Sprint 3.5 — Tests for Config Loader (ConfigLoader / LoaderModule)
 */

import { ConfigLoader } from "../../src/kernel/config/loader.js";

// Helper — build a mock response for global.fetch
function mockFetchResponse({
    ok = true,
    status = 200,
    contentType = "application/json; charset=utf-8",
    json = {},
} = {}) {
    return Promise.resolve({
        ok,
        status,
        headers: {
            get: (header) => (header.toLowerCase() === "content-type" ? contentType : null),
        },
        json: () =>
            json !== "__THROW__"
                ? Promise.resolve(json)
                : Promise.reject(new SyntaxError("Unexpected token < in JSON")),
    });
}

beforeEach(() => {
    global.fetch.mockReset();
});

// ─────────────────────────────────────────
// 3.5.1  ConfigLoader.loadUrl()
// ─────────────────────────────────────────
describe("ConfigLoader.loadUrl()", () => {
    it("resolves with parsed JSON for a valid response", async () => {
        const config = { map: { zoom: 12 } };
        global.fetch.mockReturnValue(mockFetchResponse({ json: config }));

        const result = await ConfigLoader.loadUrl("https://example.com/config.json");
        expect(result).toEqual(config);
    });

    it("resolves with {} when url is empty", async () => {
        const result = await ConfigLoader.loadUrl("");
        expect(result).toEqual({});
    });

    it("resolves with {} when url is null", async () => {
        const result = await ConfigLoader.loadUrl(null);
        expect(result).toEqual({});
    });

    it("rejects on HTTP 404", async () => {
        global.fetch.mockReturnValue(mockFetchResponse({ ok: false, status: 404 }));
        await expect(ConfigLoader.loadUrl("https://example.com/missing.json")).rejects.toThrow(
            "404"
        );
    });

    it("rejects on invalid Content-Type when strictContentType is true", async () => {
        global.fetch.mockReturnValue(mockFetchResponse({ contentType: "text/html" }));
        await expect(
            ConfigLoader.loadUrl("https://example.com/config.json", { strictContentType: true })
        ).rejects.toThrow(/Content-Type/i);
    });

    it("resolves despite unexpected Content-Type when strictContentType is false", async () => {
        const config = { ui: { theme: "dark" } };
        global.fetch.mockReturnValue(
            mockFetchResponse({ contentType: "text/plain", json: config })
        );
        const result = await ConfigLoader.loadUrl("https://example.com/config.json", {
            strictContentType: false,
        });
        expect(result).toEqual(config);
    });

    it("rejects on JSON parse error", async () => {
        global.fetch.mockReturnValue(mockFetchResponse({ json: "__THROW__" }));
        await expect(ConfigLoader.loadUrl("https://example.com/bad.json")).rejects.toThrow(/JSON/i);
    });

    it("rejects for a javascript: URL (security block)", async () => {
        await expect(ConfigLoader.loadUrl("javascript:alert(1)")).rejects.toThrow();
    });

    it("accepts a relative URL without validation", async () => {
        const config = { test: true };
        global.fetch.mockReturnValue(mockFetchResponse({ json: config }));
        const result = await ConfigLoader.loadUrl("./relative/config.json");
        expect(result).toEqual(config);
    });

    it("passes custom headers to fetch", async () => {
        global.fetch.mockReturnValue(mockFetchResponse({ json: {} }));
        await ConfigLoader.loadUrl("https://example.com/config.json", {
            headers: { "X-CSRF-Token": "my-token" },
        });
        const fetchCall = global.fetch.mock.calls[0];
        expect(fetchCall[1].headers["X-CSRF-Token"]).toBe("my-token");
    });
});

// ─────────────────────────────────────────
// fetchJson()
// ─────────────────────────────────────────
describe("ConfigLoader.fetchJson()", () => {
    it("resolves with parsed JSON for a valid response", async () => {
        const payload = { layers: [] };
        global.fetch.mockReturnValue(mockFetchResponse({ json: payload }));
        const result = await ConfigLoader.fetchJson("https://example.com/data.json");
        expect(result).toEqual(payload);
    });

    it("resolves null when url is empty", async () => {
        const result = await ConfigLoader.fetchJson("");
        expect(result).toBeNull();
    });

    it("rejects on HTTP 500", async () => {
        global.fetch.mockReturnValue(mockFetchResponse({ ok: false, status: 500 }));
        await expect(ConfigLoader.fetchJson("https://example.com/error.json")).rejects.toThrow(
            "500"
        );
    });

    it("rejects on invalid Content-Type", async () => {
        global.fetch.mockReturnValue(mockFetchResponse({ contentType: "text/html" }));
        await expect(ConfigLoader.fetchJson("https://example.com/bad.json")).rejects.toThrow(
            /Content-Type/i
        );
    });
});
